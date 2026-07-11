import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRedisTransactionConflict,
  redisTransactionConflictError,
  retryRedisTransaction,
} from './redisTransactionRetry.js';

void test('recognizes hosted and caller-created transaction conflicts', () => {
  assert.equal(
    isRedisTransactionConflict(new Error('redis: transaction failed')),
    true
  );
  assert.equal(
    isRedisTransactionConflict({ message: 'redis: transaction failed' }),
    true
  );
  assert.equal(
    isRedisTransactionConflict(
      new Error('2 UNKNOWN: redis: transaction failed')
    ),
    true
  );
  assert.equal(
    isRedisTransactionConflict(redisTransactionConflictError()),
    true
  );
  assert.equal(
    isRedisTransactionConflict(new Error('redis: transaction failed ')),
    false
  );
  assert.equal(isRedisTransactionConflict(new Error('unavailable')), false);
  assert.equal(isRedisTransactionConflict('redis: transaction failed'), false);
});

void test('returns immediately when the first transaction attempt succeeds', async () => {
  const attempts: number[] = [];
  const delays: number[] = [];

  const result = await retryRedisTransaction(
    async (attempt) => {
      attempts.push(attempt);
      return 'committed';
    },
    {
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    }
  );

  assert.equal(result, 'committed');
  assert.deepEqual(attempts, [1]);
  assert.deepEqual(delays, []);
});

void test('retries hosted conflicts with deterministic exponential jitter', async () => {
  const attempts: number[] = [];
  const delays: number[] = [];
  const randomValues = [0.5, 0.25];

  const result = await retryRedisTransaction(
    async (attempt) => {
      attempts.push(attempt);
      if (attempt < 3) throw new Error('redis: transaction failed');
      return 'committed';
    },
    {
      maxAttempts: 4,
      baseDelayMs: 10,
      maxDelayMs: 100,
      random: () => randomValues.shift() ?? 0,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    }
  );

  assert.equal(result, 'committed');
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(delays, [5, 5]);
});

void test('caps exponential delays and rethrows the final caller conflict', async () => {
  const attempts: number[] = [];
  const delays: number[] = [];
  const conflicts = Array.from({ length: 5 }, () =>
    redisTransactionConflictError()
  );

  await assert.rejects(
    retryRedisTransaction(
      async (attempt) => {
        attempts.push(attempt);
        throw conflicts[attempt - 1];
      },
      {
        maxAttempts: 5,
        baseDelayMs: 40,
        maxDelayMs: 100,
        random: () => 1,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      }
    ),
    (error: unknown) => {
      assert.equal(error, conflicts[4]);
      return true;
    }
  );

  assert.deepEqual(attempts, [1, 2, 3, 4, 5]);
  assert.deepEqual(delays, [40, 80, 100, 100]);
});

void test('does not retry or wrap non-conflict errors', async () => {
  const original = new Error('permission denied');
  let attempts = 0;
  let sleeps = 0;

  await assert.rejects(
    retryRedisTransaction(
      async () => {
        attempts += 1;
        throw original;
      },
      {
        sleep: async () => {
          sleeps += 1;
        },
      }
    ),
    (error: unknown) => {
      assert.equal(error, original);
      return true;
    }
  );

  assert.equal(attempts, 1);
  assert.equal(sleeps, 0);
});
