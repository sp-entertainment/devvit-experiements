import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REALTIME_STRESS_EXPECTED_MESSAGES,
  buildRealtimeStressSchedule,
  createRealtimeStressStats,
  currentRealtimeStressRate,
  finalizeRealtimeStressStats,
  recordRealtimeStressMessage,
  type RealtimeStressDataMessage,
  type RealtimeStressServerSummary,
} from '../shared/realtimeStress.js';
import { runRealtimeStress } from './realtimeStressRunner.js';

void test('stress schedule continuously covers all four exact phases and pauses', () => {
  const schedule = buildRealtimeStressSchedule();
  assert.equal(schedule.length, 3_500);
  assert.deepEqual(
    schedule.reduce<number[]>((counts, item) => {
      counts[item.phaseIndex] = (counts[item.phaseIndex] ?? 0) + 1;
      return counts;
    }, []),
    [1_250, 1_000, 750, 500]
  );
  assert.deepEqual(schedule[0], {
    sequence: 1,
    phaseIndex: 0,
    targetRate: 250,
    dueOffsetMs: 0,
  });
  assert.equal(schedule[1_249]?.dueOffsetMs, 4_996);
  assert.equal(schedule[1_250]?.dueOffsetMs, 6_000);
  assert.equal(schedule[2_249]?.dueOffsetMs, 10_995);
  assert.equal(schedule[2_250]?.dueOffsetMs, 12_000);
  assert.equal(schedule[2_999]?.dueOffsetMs, 16_993.333333333332);
  assert.equal(schedule[3_000]?.dueOffsetMs, 18_000);
  assert.equal(schedule[3_499]?.dueOffsetMs, 22_990);
  assert.equal(schedule[3_499]?.sequence, REALTIME_STRESS_EXPECTED_MESSAGES);
});

void test('runner paces against absolute time and aggregates send rejections', async () => {
  let clock = 10_000;
  const sent: RealtimeStressDataMessage[] = [];
  const rejected = new Set([1, 1_251, 2_251, 3_001]);

  const summary = await runRealtimeStress({
    channel: 'stress_channel',
    runId: '00000000-0000-4000-8000-000000000001',
    startedAt: clock + 500,
    now: () => clock,
    sleep: async (delayMs) => {
      clock += delayMs;
    },
    send: async (_channel, message) => {
      sent.push(message);
      if (rejected.has(message.sequence)) throw new Error('limited');
    },
  });

  assert.equal(sent.length, 3_500);
  assert.equal(sent[0]?.sentAt, 10_500);
  assert.equal(sent[1_249]?.sentAt, 15_496);
  assert.equal(sent[1_250]?.sentAt, 16_500);
  assert.equal(sent[3_499]?.sentAt, 33_490);
  assert.equal(summary.succeeded, 3_496);
  assert.equal(summary.rejected, 4);
  assert.equal(summary.actualDurationMs, 23_000);
  assert.equal(summary.sendSpanMs, 22_990);
  assert.equal(summary.averageScheduleLagMs, 0);
  assert.deepEqual(summary.failedSequences, [1, 1_251, 2_251, 3_001]);
  assert.deepEqual(
    summary.phases.map((phase) => phase.rejected),
    [1, 1, 1, 1]
  );
  assert.deepEqual(summary.sendsPerSecond, [
    250,
    250,
    250,
    250,
    250,
    0,
    200,
    200,
    200,
    200,
    200,
    0,
    150,
    150,
    150,
    150,
    150,
    0,
    100,
    100,
    100,
    100,
    100,
  ]);
});

void test('client statistics distinguish duplicates, ordering, and delivery loss', () => {
  const runId = '00000000-0000-4000-8000-000000000002';
  const stats = createRealtimeStressStats(runId);
  const message = (
    sequence: number,
    phaseIndex: number,
    targetRate: number
  ): RealtimeStressDataMessage => ({
    type: 'realtimeStressData',
    runId,
    sequence,
    phaseIndex,
    targetRate,
    scheduledAt: 0,
    sentAt: 0,
  });

  recordRealtimeStressMessage(stats, message(1, 0, 250), 0);
  recordRealtimeStressMessage(stats, message(3, 0, 250), 100);
  recordRealtimeStressMessage(stats, message(3, 0, 250), 150);
  recordRealtimeStressMessage(stats, message(2, 0, 250), 200);
  recordRealtimeStressMessage(stats, message(1_251, 1, 200), 1_300);

  const summary: RealtimeStressServerSummary = {
    runId,
    outcome: 'completed',
    startedAt: 0,
    endedAt: 23_000,
    attempted: 3_500,
    succeeded: 3_499,
    rejected: 1,
    failedSequences: [4],
    phases: [
      {
        phaseIndex: 0,
        targetRate: 250,
        attempted: 1_250,
        succeeded: 1_249,
        rejected: 1,
        firstSentAt: 0,
        lastSentAt: 4_996,
        sendSpanMs: 4_996,
        averageScheduleLagMs: 0,
        maxScheduleLagMs: 0,
      },
      {
        phaseIndex: 1,
        targetRate: 200,
        attempted: 1_000,
        succeeded: 1_000,
        rejected: 0,
        firstSentAt: 6_000,
        lastSentAt: 10_995,
        sendSpanMs: 4_995,
        averageScheduleLagMs: 0,
        maxScheduleLagMs: 0,
      },
      {
        phaseIndex: 2,
        targetRate: 150,
        attempted: 750,
        succeeded: 750,
        rejected: 0,
        firstSentAt: 12_000,
        lastSentAt: 16_993,
        sendSpanMs: 4_993,
        averageScheduleLagMs: 0,
        maxScheduleLagMs: 0,
      },
      {
        phaseIndex: 3,
        targetRate: 100,
        attempted: 500,
        succeeded: 500,
        rejected: 0,
        firstSentAt: 18_000,
        lastSentAt: 22_990,
        sendSpanMs: 4_990,
        averageScheduleLagMs: 0,
        maxScheduleLagMs: 0,
      },
    ],
    actualDurationMs: 23_000,
    sendSpanMs: 22_990,
    averageScheduleLagMs: 0,
    maxScheduleLagMs: 0,
    sendsPerSecond: [],
    error: null,
  };
  const result = finalizeRealtimeStressStats(
    stats,
    summary,
    '00000000-0000-4000-8000-000000000003',
    'tester',
    2,
    16_000
  );

  assert.equal(currentRealtimeStressRate(stats, 500), 4);
  assert.equal(result.received, 4);
  assert.equal(result.duplicates, 1);
  assert.equal(result.outOfOrder, 1);
  assert.equal(result.peakMessagesPerSecond, 3);
  assert.equal(result.missingAttempts, 3_496);
  assert.equal(result.deliveryMissing, 3_495);
  assert.equal(result.disconnects, 2);
  assert.equal(result.phases[0]?.averageMessagesPerSecond, 0.6);
  assert.equal(result.phases[1]?.averageMessagesPerSecond, 0.2);
  assert.equal(result.averageMessagesPerSecond, 0.2);
  assert.equal(result.activeAverageMessagesPerSecond, 0.2);
  assert.equal(result.receiptSpanMs, 1_300);
  assert.deepEqual(result.receivedPerSecond, [3, 1]);
});
