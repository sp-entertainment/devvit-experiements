import {
  connectRealtime,
  disconnectRealtime,
  showToast,
} from '@devvit/web/client';
import {
  REALTIME_STRESS_ACTIVE_DURATION_MS,
  REALTIME_STRESS_DURATION_MS,
  REALTIME_STRESS_EXPECTED_MESSAGES,
  REALTIME_STRESS_PHASES,
  createRealtimeStressStats,
  currentRealtimeStressRate,
  finalizeRealtimeStressStats,
  recordRealtimeStressMessage,
  type RealtimeStressDataMessage,
  type RealtimeStressLobbySnapshot,
  type RealtimeStressStats,
} from '../shared/realtimeStress';
import { trpc } from './trpc';
import { el, errorMessage, paragraph, sectionHeading } from './kitchenSink/ui';

const emptySnapshot = (): RealtimeStressLobbySnapshot => ({
  status: 'empty',
  lobbyId: null,
  participants: [],
  readyCount: 0,
  pendingCount: 0,
  runId: null,
  startedAt: null,
  endsAt: null,
  summary: null,
  results: [],
  serverNow: Date.now(),
});

const formatNumber = (value: number): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

// Keep one identity for the lifetime of this webview. Switching kitchen-sink tabs
// remounts the Stress UI, but it must not make the same browser look like a new client.
const realtimeStressClientId = crypto.randomUUID();

export const startRealtimeStressTab = (
  container: HTMLElement
): (() => void) => {
  const clientId = realtimeStressClientId;
  let destroyed = false;
  let joining = false;
  let ready = false;
  let startInFlight = false;
  let channel: string | undefined;
  let joinedLobbyId: string | undefined;
  let username = 'unknown';
  let latestSnapshot = emptySnapshot();
  let stats: RealtimeStressStats | undefined;
  let disconnects = 0;
  let polling = false;
  let serverNowAtPoll = Date.now();
  let monotonicAtPoll = performance.now();
  let finalizeTimer: ReturnType<typeof setTimeout> | undefined;
  const submittedRunIds = new Set<string>();

  container.append(
    sectionHeading('Realtime Stress'),
    paragraph(
      'Join one or more clients, then have any joined client start four five-second publish phases at 250, 200, 150, and 100 messages per second, with a one-second pause between phases.'
    )
  );

  const warning = el('p', 'ks-stress-warning');
  warning.textContent =
    'This 23-second profile measures a quota shared by the whole installation. Unrelated Realtime publishes may affect the result.';

  const status = el('p', 'ks-status');
  const controls = el('div', 'ks-stress-controls');
  const joinButton = el('button', 'ks-button');
  joinButton.textContent = 'Join';
  const startButton = el('button', 'ks-button');
  startButton.textContent = 'Start';
  const resetButton = el('button', 'ks-button');
  resetButton.textContent = 'New Test';
  controls.append(joinButton, startButton, resetButton);

  const liveHeading = el('h3', 'ks-row-title');
  liveHeading.textContent = 'Live client statistics';
  const liveOutput = el('pre', 'ks-output ks-stress-live');
  liveOutput.textContent = '(join the lobby to begin)';

  const participantHeading = el('h3', 'ks-row-title');
  participantHeading.textContent = 'Participants';
  const participantTable = el('table', 'ks-score-table');
  const participantHead = document.createElement('thead');
  const participantHeadRow = document.createElement('tr');
  for (const label of ['Client', 'Connection']) {
    const cell = document.createElement('th');
    cell.textContent = label;
    participantHeadRow.append(cell);
  }
  participantHead.append(participantHeadRow);
  const participantBody = document.createElement('tbody');
  participantTable.append(participantHead, participantBody);

  const resultHeading = el('h3', 'ks-row-title');
  resultHeading.textContent = 'Shared results';
  const resultTable = el('table', 'ks-score-table ks-stress-results');
  const resultHead = document.createElement('thead');
  const resultHeadRow = document.createElement('tr');
  for (const label of [
    'Client',
    'Received',
    'Actual active avg/s',
    'Planned active avg/s',
    'Peak/s',
    'Receipt span',
    '250/s delivered',
    '200/s delivered',
    '150/s delivered',
    '100/s delivered',
    'Server rejected',
    'Delivery missing',
    'Dupes / OOO / Disconnects',
  ]) {
    const cell = document.createElement('th');
    cell.textContent = label;
    resultHeadRow.append(cell);
  }
  resultHead.append(resultHeadRow);
  const resultBody = document.createElement('tbody');
  resultTable.append(resultHead, resultBody);

  container.append(
    warning,
    status,
    controls,
    liveHeading,
    liveOutput,
    participantHeading,
    participantTable,
    resultHeading,
    resultTable
  );

  const shortClient = (value: string): string => value.slice(0, 8);

  const renderParticipants = (): void => {
    participantBody.replaceChildren();
    if (latestSnapshot.participants.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 2;
      cell.textContent = 'No clients have joined.';
      row.append(cell);
      participantBody.append(row);
      return;
    }

    for (const participant of latestSnapshot.participants) {
      const row = document.createElement('tr');
      const identity = document.createElement('td');
      identity.textContent = `${participant.username} (${shortClient(participant.clientId)})`;
      const connection = document.createElement('td');
      connection.textContent = participant.ready ? 'Ready' : 'Connecting…';
      row.append(identity, connection);
      participantBody.append(row);
    }
  };

  const renderResults = (): void => {
    resultBody.replaceChildren();
    const summary = latestSnapshot.summary;
    for (const participant of latestSnapshot.participants) {
      const result = latestSnapshot.results.find(
        (candidate) => candidate.clientId === participant.clientId
      );
      const row = document.createElement('tr');
      const values = result
        ? [
            `${result.username} (${shortClient(result.clientId)})`,
            formatNumber(result.received),
            formatNumber(result.averageMessagesPerSecond),
            formatNumber(result.activeAverageMessagesPerSecond),
            formatNumber(result.peakMessagesPerSecond),
            `${formatNumber(result.receiptSpanMs)} ms`,
            `${formatNumber(result.phases[0]?.averageMessagesPerSecond ?? 0)}/s (${formatNumber(result.phases[0]?.deliveryPercent ?? 0)}%)`,
            `${formatNumber(result.phases[1]?.averageMessagesPerSecond ?? 0)}/s (${formatNumber(result.phases[1]?.deliveryPercent ?? 0)}%)`,
            `${formatNumber(result.phases[2]?.averageMessagesPerSecond ?? 0)}/s (${formatNumber(result.phases[2]?.deliveryPercent ?? 0)}%)`,
            `${formatNumber(result.phases[3]?.averageMessagesPerSecond ?? 0)}/s (${formatNumber(result.phases[3]?.deliveryPercent ?? 0)}%)`,
            formatNumber(summary?.rejected ?? 0),
            formatNumber(result.deliveryMissing),
            `${result.duplicates} / ${result.outOfOrder} / ${result.disconnects}`,
          ]
        : [
            `${participant.username} (${shortClient(participant.clientId)})`,
            latestSnapshot.status === 'completed' ||
            latestSnapshot.status === 'failed'
              ? 'Reporting…'
              : '—',
            '—',
            '—',
            '—',
            '—',
            '—',
            '—',
            '—',
            '—',
            formatNumber(summary?.rejected ?? 0),
            '—',
            '—',
          ];
      for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      resultBody.append(row);
    }

    if (latestSnapshot.participants.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 13;
      cell.textContent = 'Results will appear after a test.';
      row.append(cell);
      resultBody.append(row);
    }
  };

  const renderLive = (): void => {
    if (!stats) {
      liveOutput.textContent =
        latestSnapshot.status === 'running'
          ? 'Waiting for the first stress-test message…'
          : latestSnapshot.status === 'completed' ||
              latestSnapshot.status === 'failed'
            ? '(local measurements are unavailable after remount; see shared results)'
            : '(no active run)';
      return;
    }

    const received = stats.receivedSequences.size;
    const estimatedServerNow =
      serverNowAtPoll + (performance.now() - monotonicAtPoll);
    const durationSeconds = REALTIME_STRESS_DURATION_MS / 1_000;
    const elapsedSeconds = Math.min(
      durationSeconds,
      Math.max(
        0.001,
        latestSnapshot.startedAt
          ? (estimatedServerNow - latestSnapshot.startedAt) / 1_000
          : durationSeconds
      )
    );
    const summary = latestSnapshot.summary;
    const lines = [
      `Run: ${stats.runId}`,
      `Current trailing rate: ${currentRealtimeStressRate(stats, performance.now())} messages/s`,
      `Received unique: ${received.toLocaleString()} / ${REALTIME_STRESS_EXPECTED_MESSAGES.toLocaleString()}`,
      `Measured wall-clock average so far: ${formatNumber(received / elapsedSeconds)} messages/s`,
      `Duplicates: ${stats.duplicates.toLocaleString()}`,
      `Out of order: ${stats.outOfOrder.toLocaleString()}`,
      `Disconnects: ${disconnects.toLocaleString()}`,
    ];
    if (summary) {
      const diagnostics = finalizeRealtimeStressStats(
        stats,
        summary,
        clientId,
        username,
        disconnects,
        Date.now()
      );
      lines.push(
        `Server succeeded: ${summary.succeeded.toLocaleString()}`,
        `Server rejected: ${summary.rejected.toLocaleString()}`,
        `Unreceived attempts: ${(REALTIME_STRESS_EXPECTED_MESSAGES - received).toLocaleString()}`,
        `Server actual duration: ${formatNumber(summary.actualDurationMs)} ms`,
        `Server send span: ${formatNumber(summary.sendSpanMs)} ms`,
        `Server schedule lag avg/max: ${formatNumber(summary.averageScheduleLagMs)} / ${formatNumber(summary.maxScheduleLagMs)} ms`,
        `Client receipt span: ${formatNumber(diagnostics.receiptSpanMs)} ms`,
        `Actual active average (planned pauses excluded): ${formatNumber(diagnostics.averageMessagesPerSecond)} messages/s`,
        `Planned active average (${formatNumber(REALTIME_STRESS_ACTIVE_DURATION_MS / 1_000)} active seconds): ${formatNumber(diagnostics.activeAverageMessagesPerSecond)} messages/s`,
        `Receipt-span average: ${formatNumber(diagnostics.receiptSpanAverageMessagesPerSecond)} messages/s`,
        `Server sends by elapsed second: ${summary.sendsPerSecond.join(', ')}`,
        `Client receives by elapsed second: ${diagnostics.receivedPerSecond.join(', ')}`
      );
      for (const phase of diagnostics.phases) {
        const expected =
          REALTIME_STRESS_PHASES[phase.phaseIndex]?.expectedMessages ?? 0;
        lines.push(
          `${phase.targetRate}/s phase: ${phase.received.toLocaleString()} / ${expected.toLocaleString()} delivered (${formatNumber(phase.deliveryPercent)}%); normalized ${formatNumber(phase.averageMessagesPerSecond)}/s; receipt span ${formatNumber(phase.receiptSpanMs)} ms`
        );
      }
    }
    liveOutput.textContent = lines.join('\n');
  };

  const render = (): void => {
    const joined = latestSnapshot.participants.some(
      (participant) => participant.clientId === clientId && participant.ready
    );
    ready = joined;
    const stateLabel =
      latestSnapshot.status[0]?.toUpperCase() + latestSnapshot.status.slice(1);
    status.textContent = `${stateLabel} · ${latestSnapshot.readyCount} ready · ${latestSnapshot.pendingCount} connecting`;
    joinButton.disabled =
      joining ||
      ready ||
      (latestSnapshot.status !== 'empty' && latestSnapshot.status !== 'idle');
    startButton.disabled =
      startInFlight ||
      latestSnapshot.status !== 'idle' ||
      !ready ||
      latestSnapshot.readyCount < 1 ||
      latestSnapshot.pendingCount > 0;
    resetButton.disabled =
      latestSnapshot.status !== 'completed' &&
      latestSnapshot.status !== 'failed';
    renderParticipants();
    renderResults();
    renderLive();
  };

  const ensureStats = (runId: string): RealtimeStressStats => {
    if (!stats || stats.runId !== runId) {
      stats = createRealtimeStressStats(runId);
      disconnects = 0;
    }
    return stats;
  };

  const submitFinalResult = async (): Promise<void> => {
    const summary = latestSnapshot.summary;
    if (!summary || submittedRunIds.has(summary.runId)) return;
    const alreadyReported = latestSnapshot.results.some(
      (result) => result.clientId === clientId && result.runId === summary.runId
    );
    if (alreadyReported) {
      submittedRunIds.add(summary.runId);
      return;
    }
    const wasParticipant = latestSnapshot.participants.some(
      (participant) => participant.clientId === clientId
    );
    if (!wasParticipant || !stats || stats.runId !== summary.runId) return;
    const currentStats = stats;
    submittedRunIds.add(summary.runId);
    try {
      const result = finalizeRealtimeStressStats(
        currentStats,
        summary,
        clientId,
        username,
        disconnects,
        Date.now()
      );
      await trpc.realtimeStress.submitResult.mutate(result);
    } catch (error) {
      submittedRunIds.delete(summary.runId);
      console.error('Failed to submit Realtime stress-test result:', error);
      if (!destroyed)
        showToast(`Result submission failed: ${errorMessage(error)}`);
    }
  };

  const scheduleFinalResult = (): void => {
    const summary = latestSnapshot.summary;
    if (!summary || submittedRunIds.has(summary.runId) || finalizeTimer) return;
    if (
      latestSnapshot.results.some(
        (result) =>
          result.clientId === clientId && result.runId === summary.runId
      )
    ) {
      submittedRunIds.add(summary.runId);
      return;
    }
    if (
      !stats ||
      stats.runId !== summary.runId ||
      !latestSnapshot.participants.some(
        (participant) => participant.clientId === clientId
      )
    ) {
      return;
    }
    finalizeTimer = setTimeout(() => {
      finalizeTimer = undefined;
      if (!destroyed) void submitFinalResult();
    }, 1_000);
  };

  const detachFromOldLobby = (): void => {
    if (channel) disconnectRealtime(channel);
    channel = undefined;
    joinedLobbyId = undefined;
    ready = false;
    stats = undefined;
    disconnects = 0;
    submittedRunIds.clear();
    if (finalizeTimer) clearTimeout(finalizeTimer);
    finalizeTimer = undefined;
  };

  const pollStatus = async (): Promise<void> => {
    if (destroyed || polling) return;
    polling = true;
    try {
      const nextSnapshot = await trpc.realtimeStress.status.query();
      serverNowAtPoll = nextSnapshot.serverNow;
      monotonicAtPoll = performance.now();
      if (joinedLobbyId && nextSnapshot.lobbyId !== joinedLobbyId) {
        detachFromOldLobby();
      }
      latestSnapshot = nextSnapshot;
      if (
        (latestSnapshot.status === 'completed' ||
          latestSnapshot.status === 'failed') &&
        latestSnapshot.summary
      ) {
        scheduleFinalResult();
      }
      render();
    } catch (error) {
      console.error('Failed to poll Realtime stress-test status:', error);
      status.textContent = `Status error: ${errorMessage(error)}`;
    } finally {
      polling = false;
    }
  };

  joinButton.addEventListener('click', () => {
    void (async () => {
      joining = true;
      render();
      try {
        const joined = await trpc.realtimeStress.join.mutate({ clientId });
        username = joined.username;
        joinedLobbyId = joined.lobbyId;
        channel = joined.channel;
        connectRealtime<RealtimeStressDataMessage>({
          channel: joined.channel,
          onConnect: () => {
            void (async () => {
              try {
                latestSnapshot = await trpc.realtimeStress.ready.mutate({
                  clientId,
                  lobbyId: joined.lobbyId,
                });
                serverNowAtPoll = latestSnapshot.serverNow;
                monotonicAtPoll = performance.now();
                ready = true;
                render();
              } catch (error) {
                console.error(
                  'Failed to mark stress-test client ready:',
                  error
                );
                showToast(`Join failed: ${errorMessage(error)}`);
              }
            })();
          },
          onDisconnect: () => {
            if (stats) disconnects += 1;
            ready = false;
            if (
              !destroyed &&
              joinedLobbyId &&
              latestSnapshot.status === 'idle'
            ) {
              void trpc.realtimeStress.leave
                .mutate({ clientId, lobbyId: joinedLobbyId })
                .then(() => pollStatus())
                .catch((error) =>
                  console.debug(
                    'Unable to leave disconnected stress client:',
                    error
                  )
                );
            }
            render();
          },
          onMessage: (message) => {
            recordRealtimeStressMessage(
              ensureStats(message.runId),
              message,
              performance.now()
            );
            renderLive();
          },
        });
      } catch (error) {
        console.error('Failed to join Realtime stress test:', error);
        showToast(`Join failed: ${errorMessage(error)}`);
      } finally {
        joining = false;
        render();
      }
    })();
  });

  startButton.addEventListener('click', () => {
    void (async () => {
      if (!joinedLobbyId) return;
      startInFlight = true;
      render();
      try {
        await trpc.realtimeStress.start.mutate({
          clientId,
          lobbyId: joinedLobbyId,
        });
      } catch (error) {
        console.error('Realtime stress test failed:', error);
        showToast(`Stress test failed: ${errorMessage(error)}`);
      } finally {
        startInFlight = false;
        await pollStatus();
        render();
      }
    })();
  });

  resetButton.addEventListener('click', () => {
    void (async () => {
      try {
        detachFromOldLobby();
        latestSnapshot = await trpc.realtimeStress.reset.mutate();
        serverNowAtPoll = latestSnapshot.serverNow;
        monotonicAtPoll = performance.now();
        render();
      } catch (error) {
        console.error('Failed to reset Realtime stress test:', error);
        showToast(`Reset failed: ${errorMessage(error)}`);
      }
    })();
  });

  const statusTimer = setInterval(() => void pollStatus(), 1_000);
  const liveTimer = setInterval(renderLive, 250);
  void pollStatus();

  return () => {
    destroyed = true;
    clearInterval(statusTimer);
    clearInterval(liveTimer);
    if (finalizeTimer) clearTimeout(finalizeTimer);
    if (channel) disconnectRealtime(channel);
    if (joinedLobbyId && latestSnapshot.status === 'idle') {
      void trpc.realtimeStress.leave
        .mutate({ clientId, lobbyId: joinedLobbyId })
        .catch((error) =>
          console.debug('Unable to leave stress-test lobby:', error)
        );
    }
  };
};
