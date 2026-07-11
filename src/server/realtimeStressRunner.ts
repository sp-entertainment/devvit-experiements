import {
  REALTIME_STRESS_DURATION_MS,
  REALTIME_STRESS_PHASES,
  buildRealtimeStressSchedule,
  type RealtimeStressDataMessage,
  type RealtimeStressServerSummary,
} from '../shared/realtimeStress.js';

type SendRealtime = (
  channel: string,
  message: RealtimeStressDataMessage
) => Promise<void>;

type Sleep = (delayMs: number) => Promise<void>;

export type RealtimeStressRunnerOptions = {
  channel: string;
  runId: string;
  startedAt: number;
  send: SendRealtime;
  now?: () => number;
  sleep?: Sleep;
};

const defaultSleep: Sleep = async (delayMs) => {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
};

export const runRealtimeStress = async (
  options: RealtimeStressRunnerOptions
): Promise<RealtimeStressServerSummary> => {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const schedule = buildRealtimeStressSchedule();
  const failedSequences: number[] = [];
  const phaseSucceeded = REALTIME_STRESS_PHASES.map(() => 0);
  const phaseRejected = REALTIME_STRESS_PHASES.map(() => 0);
  const phaseFirstSentAt: Array<number | null> = REALTIME_STRESS_PHASES.map(
    () => null
  );
  const phaseLastSentAt: Array<number | null> = REALTIME_STRESS_PHASES.map(
    () => null
  );
  const phaseScheduleLagTotal = REALTIME_STRESS_PHASES.map(() => 0);
  const phaseScheduleLagMax = REALTIME_STRESS_PHASES.map(() => 0);
  const sendsPerSecond: number[] = [];
  const pending: Promise<void>[] = [];
  let firstSentAt: number | null = null;
  let lastSentAt: number | null = null;
  let scheduleLagTotal = 0;
  let scheduleLagMax = 0;

  const initialDelay = options.startedAt - now();
  if (initialDelay > 0) await sleep(initialDelay);

  for (const item of schedule) {
    const dueAt = options.startedAt + item.dueOffsetMs;
    const delayMs = dueAt - now();
    if (delayMs > 0) await sleep(delayMs);

    const sentAt = now();
    const scheduleLagMs = Math.max(0, sentAt - dueAt);
    firstSentAt ??= sentAt;
    lastSentAt = sentAt;
    phaseFirstSentAt[item.phaseIndex] ??= sentAt;
    phaseLastSentAt[item.phaseIndex] = sentAt;
    phaseScheduleLagTotal[item.phaseIndex] =
      (phaseScheduleLagTotal[item.phaseIndex] ?? 0) + scheduleLagMs;
    phaseScheduleLagMax[item.phaseIndex] = Math.max(
      phaseScheduleLagMax[item.phaseIndex] ?? 0,
      scheduleLagMs
    );
    scheduleLagTotal += scheduleLagMs;
    scheduleLagMax = Math.max(scheduleLagMax, scheduleLagMs);
    const secondIndex = Math.max(
      0,
      Math.floor((sentAt - options.startedAt) / 1_000)
    );
    while (sendsPerSecond.length <= secondIndex) sendsPerSecond.push(0);
    sendsPerSecond[secondIndex] = (sendsPerSecond[secondIndex] ?? 0) + 1;

    const message: RealtimeStressDataMessage = {
      type: 'realtimeStressData',
      runId: options.runId,
      sequence: item.sequence,
      phaseIndex: item.phaseIndex,
      targetRate: item.targetRate,
      scheduledAt: Math.round(dueAt),
      sentAt,
    };

    const attempt = options.send(options.channel, message).then(
      () => {
        phaseSucceeded[item.phaseIndex] =
          (phaseSucceeded[item.phaseIndex] ?? 0) + 1;
      },
      () => {
        failedSequences.push(item.sequence);
        phaseRejected[item.phaseIndex] =
          (phaseRejected[item.phaseIndex] ?? 0) + 1;
      }
    );
    pending.push(attempt);
  }

  const profileEndDelay =
    options.startedAt + REALTIME_STRESS_DURATION_MS - now();
  if (profileEndDelay > 0) await sleep(profileEndDelay);
  await Promise.all(pending);
  const succeeded = phaseSucceeded.reduce((total, count) => total + count, 0);
  const rejected = phaseRejected.reduce((total, count) => total + count, 0);
  const endedAt = now();
  const plannedBucketCount = Math.ceil(REALTIME_STRESS_DURATION_MS / 1_000);
  while (sendsPerSecond.length < plannedBucketCount) sendsPerSecond.push(0);
  const sendSpanMs =
    firstSentAt === null || lastSentAt === null
      ? 0
      : Math.max(0, lastSentAt - firstSentAt);

  return {
    runId: options.runId,
    outcome: 'completed',
    startedAt: options.startedAt,
    endedAt,
    attempted: schedule.length,
    succeeded,
    rejected,
    failedSequences: failedSequences.sort((left, right) => left - right),
    phases: REALTIME_STRESS_PHASES.map((phase) => {
      const phaseFirst = phaseFirstSentAt[phase.index] ?? null;
      const phaseLast = phaseLastSentAt[phase.index] ?? null;
      return {
        phaseIndex: phase.index,
        targetRate: phase.targetRate,
        attempted: phase.expectedMessages,
        succeeded: phaseSucceeded[phase.index] ?? 0,
        rejected: phaseRejected[phase.index] ?? 0,
        firstSentAt: phaseFirst,
        lastSentAt: phaseLast,
        sendSpanMs:
          phaseFirst === null || phaseLast === null
            ? 0
            : Math.max(0, phaseLast - phaseFirst),
        averageScheduleLagMs:
          phase.expectedMessages === 0
            ? 0
            : (phaseScheduleLagTotal[phase.index] ?? 0) /
              phase.expectedMessages,
        maxScheduleLagMs: phaseScheduleLagMax[phase.index] ?? 0,
      };
    }),
    actualDurationMs: Math.max(0, endedAt - options.startedAt),
    sendSpanMs,
    averageScheduleLagMs:
      schedule.length === 0 ? 0 : scheduleLagTotal / schedule.length,
    maxScheduleLagMs: scheduleLagMax,
    sendsPerSecond,
    error: null,
  };
};
