import assert from 'node:assert/strict';
import test from 'node:test';

import { finishAgentRun, parseAgentRun, type AgentRun } from './agent/run.js';

const runningRun = (checks: AgentRun['checks']): AgentRun => ({
  runId: '8f4af3b8-5271-4a63-b6fb-538cc5331088',
  startedAt: '2026-07-12T04:00:00.000Z',
  status: 'running',
  checks,
  artifacts: {},
  cleanupKeys: [],
});

void test('rejects malformed persisted agent runs', () => {
  assert.throws(() =>
    parseAgentRun(
      JSON.stringify({
        ...runningRun([]),
        status: 'passed',
        checks: [{ name: 'bad', passed: 'yes' }],
      })
    )
  );
});

void test('does not pass an empty run', () => {
  const run = finishAgentRun(runningRun([]), true, '2026-07-12T04:01:00.000Z');
  assert.equal(run.status, 'failed');
  assert.match(run.error ?? '', /without executing/);
});

void test('does not pass a run containing a failed check', () => {
  const run = finishAgentRun(
    runningRun([{ name: 'Redis', passed: false }]),
    true,
    '2026-07-12T04:01:00.000Z'
  );
  assert.equal(run.status, 'failed');
  assert.match(run.error ?? '', /1 check/);
});

void test('requires explicit browser approval and all checks to pass', () => {
  const failed = finishAgentRun(
    runningRun([{ name: 'Redis', passed: true }]),
    false,
    '2026-07-12T04:01:00.000Z'
  );
  assert.equal(failed.status, 'failed');

  const passed = finishAgentRun(
    runningRun([{ name: 'Redis', passed: true }]),
    true,
    '2026-07-12T04:01:00.000Z'
  );
  assert.equal(passed.status, 'passed');
  assert.equal(passed.error, undefined);
});
