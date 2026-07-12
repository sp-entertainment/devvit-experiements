export type RealtimeStressPhase = {
  index: number;
  targetRate: number;
  durationMs: number;
  expectedMessages: number;
  pauseAfterMs: number;
};

export const REALTIME_STRESS_PHASES: readonly RealtimeStressPhase[] = [
  {
    index: 0,
    targetRate: 250,
    durationMs: 5_000,
    expectedMessages: 1_250,
    pauseAfterMs: 1_000,
  },
  {
    index: 1,
    targetRate: 200,
    durationMs: 5_000,
    expectedMessages: 1_000,
    pauseAfterMs: 1_000,
  },
  {
    index: 2,
    targetRate: 150,
    durationMs: 5_000,
    expectedMessages: 750,
    pauseAfterMs: 1_000,
  },
  {
    index: 3,
    targetRate: 100,
    durationMs: 5_000,
    expectedMessages: 500,
    pauseAfterMs: 0,
  },
];

export const REALTIME_STRESS_ACTIVE_DURATION_MS = REALTIME_STRESS_PHASES.reduce(
  (total, phase) => total + phase.durationMs,
  0
);

export const REALTIME_STRESS_DURATION_MS = REALTIME_STRESS_PHASES.reduce(
  (total, phase) => total + phase.durationMs + phase.pauseAfterMs,
  0
);

export const REALTIME_STRESS_PAUSE_DURATION_MS =
  REALTIME_STRESS_DURATION_MS - REALTIME_STRESS_ACTIVE_DURATION_MS;

export const REALTIME_STRESS_EXPECTED_MESSAGES = REALTIME_STRESS_PHASES.reduce(
  (total, phase) => total + phase.expectedMessages,
  0
);

export type RealtimeStressScheduleItem = {
  sequence: number;
  phaseIndex: number;
  targetRate: number;
  dueOffsetMs: number;
};

export const buildRealtimeStressSchedule = (): RealtimeStressScheduleItem[] => {
  const schedule: RealtimeStressScheduleItem[] = [];
  let sequence = 1;
  let phaseOffsetMs = 0;

  for (const phase of REALTIME_STRESS_PHASES) {
    for (
      let phaseSequence = 0;
      phaseSequence < phase.expectedMessages;
      phaseSequence += 1
    ) {
      schedule.push({
        sequence,
        phaseIndex: phase.index,
        targetRate: phase.targetRate,
        dueOffsetMs:
          phaseOffsetMs +
          (phaseSequence * phase.durationMs) / phase.expectedMessages,
      });
      sequence += 1;
    }
    phaseOffsetMs += phase.durationMs + phase.pauseAfterMs;
  }

  return schedule;
};

export type RealtimeStressDataMessage = {
  type: 'realtimeStressData';
  runId: string;
  sequence: number;
  phaseIndex: number;
  targetRate: number;
  scheduledAt: number;
  sentAt: number;
};

export type RealtimeStressPhaseSummary = {
  phaseIndex: number;
  targetRate: number;
  attempted: number;
  succeeded: number;
  rejected: number;
  firstSentAt: number | null;
  lastSentAt: number | null;
  sendSpanMs: number;
  averageScheduleLagMs: number;
  maxScheduleLagMs: number;
};

export type RealtimeStressServerSummary = {
  runId: string;
  outcome: 'completed' | 'failed';
  startedAt: number;
  endedAt: number;
  attempted: number;
  succeeded: number;
  rejected: number;
  failedSequences: number[];
  phases: RealtimeStressPhaseSummary[];
  actualDurationMs: number;
  sendSpanMs: number;
  averageScheduleLagMs: number;
  maxScheduleLagMs: number;
  sendsPerSecond: number[];
  error: string | null;
};

export type RealtimeStressClientPhaseResult = {
  phaseIndex: number;
  targetRate: number;
  received: number;
  averageMessagesPerSecond: number;
  deliveryPercent: number;
  receiptSpanMs: number;
};

export type RealtimeStressClientResult = {
  runId: string;
  clientId: string;
  username: string;
  received: number;
  averageMessagesPerSecond: number;
  activeAverageMessagesPerSecond: number;
  receiptSpanAverageMessagesPerSecond: number;
  peakMessagesPerSecond: number;
  receiptSpanMs: number;
  receivedPerSecond: number[];
  missingAttempts: number;
  deliveryMissing: number;
  duplicates: number;
  outOfOrder: number;
  disconnects: number;
  phases: RealtimeStressClientPhaseResult[];
  submittedAt: number;
};

export type RealtimeStressParticipant = {
  clientId: string;
  username: string;
  ready: boolean;
  joinedAt: number;
};

export type RealtimeStressLobbySnapshot = {
  status: 'empty' | 'idle' | 'running' | 'completed' | 'failed';
  lobbyId: string | null;
  participants: RealtimeStressParticipant[];
  readyCount: number;
  pendingCount: number;
  runId: string | null;
  startedAt: number | null;
  endsAt: number | null;
  summary: RealtimeStressServerSummary | null;
  results: RealtimeStressClientResult[];
  serverNow: number;
};

export type RealtimeStressStats = {
  runId: string;
  receivedSequences: Set<number>;
  receiptTimes: number[];
  receipts: Map<
    number,
    {
      phaseIndex: number;
      receivedAt: number;
      sentAt: number;
      scheduledAt: number;
    }
  >;
  phaseReceived: number[];
  duplicates: number;
  outOfOrder: number;
  highestSequence: number;
};

export const createRealtimeStressStats = (
  runId: string
): RealtimeStressStats => ({
  runId,
  receivedSequences: new Set<number>(),
  receiptTimes: [],
  receipts: new Map(),
  phaseReceived: REALTIME_STRESS_PHASES.map(() => 0),
  duplicates: 0,
  outOfOrder: 0,
  highestSequence: 0,
});

export const recordRealtimeStressMessage = (
  stats: RealtimeStressStats,
  message: RealtimeStressDataMessage,
  receivedAt: number
): void => {
  if (message.runId !== stats.runId) return;
  if (stats.receivedSequences.has(message.sequence)) {
    stats.duplicates += 1;
    return;
  }

  if (message.sequence < stats.highestSequence) stats.outOfOrder += 1;
  stats.highestSequence = Math.max(stats.highestSequence, message.sequence);
  stats.receivedSequences.add(message.sequence);
  stats.receiptTimes.push(receivedAt);
  stats.receipts.set(message.sequence, {
    phaseIndex: message.phaseIndex,
    receivedAt,
    sentAt: message.sentAt,
    scheduledAt: message.scheduledAt,
  });
  stats.phaseReceived[message.phaseIndex] =
    (stats.phaseReceived[message.phaseIndex] ?? 0) + 1;
};

export const currentRealtimeStressRate = (
  stats: RealtimeStressStats,
  now: number
): number => {
  const cutoff = now - 1_000;
  let count = 0;
  for (let index = stats.receiptTimes.length - 1; index >= 0; index -= 1) {
    const receivedAt = stats.receiptTimes[index];
    if (receivedAt === undefined || receivedAt <= cutoff) break;
    count += 1;
  }
  return count;
};

export const peakRealtimeStressRate = (
  receiptTimes: readonly number[]
): number => {
  let peak = 0;
  let left = 0;
  for (let right = 0; right < receiptTimes.length; right += 1) {
    const rightTime = receiptTimes[right];
    if (rightTime === undefined) continue;
    while (left <= right) {
      const leftTime = receiptTimes[left];
      if (leftTime === undefined || rightTime - leftTime < 1_000) break;
      left += 1;
    }
    peak = Math.max(peak, right - left + 1);
  }
  return peak;
};

const rounded = (value: number): number => Math.round(value * 100) / 100;

const spanMs = (times: readonly number[]): number => {
  const first = times[0];
  const last = times[times.length - 1];
  return first === undefined || last === undefined
    ? 0
    : Math.max(0, last - first);
};

const perSecondHistogram = (times: readonly number[]): number[] => {
  const first = times[0];
  if (first === undefined) return [];
  const buckets: number[] = [];
  for (const time of times) {
    const index = Math.max(0, Math.floor((time - first) / 1_000));
    while (buckets.length <= index) buckets.push(0);
    buckets[index] = (buckets[index] ?? 0) + 1;
  }
  return buckets;
};

export const finalizeRealtimeStressStats = (
  stats: RealtimeStressStats,
  summary: RealtimeStressServerSummary,
  clientId: string,
  username: string,
  disconnects: number,
  submittedAt: number
): RealtimeStressClientResult => {
  const failed = new Set(summary.failedSequences);
  let deliveryMissing = 0;
  for (
    let sequence = 1;
    sequence <= REALTIME_STRESS_EXPECTED_MESSAGES;
    sequence += 1
  ) {
    if (!failed.has(sequence) && !stats.receivedSequences.has(sequence)) {
      deliveryMissing += 1;
    }
  }

  const received = stats.receivedSequences.size;
  const actualActiveDurationSeconds = Math.max(
    0,
    (summary.actualDurationMs - REALTIME_STRESS_PAUSE_DURATION_MS) / 1_000
  );
  const activeDurationSeconds = REALTIME_STRESS_ACTIVE_DURATION_MS / 1_000;
  const receiptSpan = spanMs(stats.receiptTimes);
  const receiptSpanSeconds = receiptSpan / 1_000;
  return {
    runId: stats.runId,
    clientId,
    username,
    received,
    averageMessagesPerSecond:
      actualActiveDurationSeconds === 0
        ? 0
        : rounded(received / actualActiveDurationSeconds),
    activeAverageMessagesPerSecond: rounded(received / activeDurationSeconds),
    receiptSpanAverageMessagesPerSecond:
      receiptSpanSeconds === 0 ? 0 : rounded(received / receiptSpanSeconds),
    peakMessagesPerSecond: peakRealtimeStressRate(stats.receiptTimes),
    receiptSpanMs: rounded(receiptSpan),
    receivedPerSecond: perSecondHistogram(stats.receiptTimes),
    missingAttempts: REALTIME_STRESS_EXPECTED_MESSAGES - received,
    deliveryMissing,
    duplicates: stats.duplicates,
    outOfOrder: stats.outOfOrder,
    disconnects,
    phases: REALTIME_STRESS_PHASES.map((phase) => {
      const phaseReceived = stats.phaseReceived[phase.index] ?? 0;
      const phaseReceiptTimes = [...stats.receipts.values()]
        .filter((receipt) => receipt.phaseIndex === phase.index)
        .map((receipt) => receipt.receivedAt);
      return {
        phaseIndex: phase.index,
        targetRate: phase.targetRate,
        received: phaseReceived,
        averageMessagesPerSecond: rounded(
          phaseReceived / (phase.durationMs / 1_000)
        ),
        deliveryPercent: rounded(
          (phaseReceived / phase.expectedMessages) * 100
        ),
        receiptSpanMs: rounded(spanMs(phaseReceiptTimes)),
      };
    }),
    submittedAt,
  };
};
