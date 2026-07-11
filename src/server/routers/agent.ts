import { context, redis } from '@devvit/web/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildId } from '../../shared/buildInfo';
import {
  executeAgentCommand,
  listAgentCommands,
  type AgentCheck,
} from '../agent/commands';
import { router, publicProcedure } from '../trpc';

type AgentRunStatus = 'running' | 'passed' | 'failed';
type AgentRun = {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  status: AgentRunStatus;
  checks: AgentCheck[];
  artifacts: Record<string, string>;
  cleanupKeys: string[];
  error?: string;
};

const runKey = (runId: string) => `agent:run:${runId}`;
const lastFailedRunKey = 'agent:last-failed-run';
const fixturePostKey = 'agent:fixture-post-id';

const saveRun = async (run: AgentRun) => {
  await redis.set(runKey(run.runId), JSON.stringify(run));
};

const loadRun = async (runId: string): Promise<AgentRun> => {
  const value = await redis.get(runKey(runId));
  if (!value) throw new Error(`Agent run not found: ${runId}`);
  return JSON.parse(value) as AgentRun;
};

const cleanupRun = async (run: AgentRun) => {
  if (run.cleanupKeys.length) await redis.del(...run.cleanupKeys);
  run.cleanupKeys = [];
  run.artifacts.cleanup = 'completed';
  await saveRun(run);
};

const cleanupPreviousFailure = async () => {
  const failedRunId = await redis.get(lastFailedRunKey);
  if (!failedRunId) return;
  const run = await loadRun(failedRunId);
  await cleanupRun(run);
  await redis.del(lastFailedRunKey);
};

export const agentRouter = router({
  listCommands: publicProcedure.query(() => listAgentCommands()),

  readiness: publicProcedure
    .input(z.object({ expectedBuildId: z.string().min(1) }))
    .query(({ input }) => ({
      expectedBuildId: input.expectedBuildId,
      serverBuildId: buildId,
      ready: input.expectedBuildId === buildId,
      postId: context.postId ?? null,
    })),

  getFixture: publicProcedure.query(async () => {
    const postId = (await redis.get(fixturePostKey)) ?? null;
    return {
      postId,
      isCurrentFixture: postId !== null && context.postId === postId,
      subredditName: context.subredditName,
    };
  }),

  startRun: publicProcedure.mutation(async () => {
    const fixturePostId = await redis.get(fixturePostKey);
    if (!fixturePostId)
      throw new Error(
        'No agent fixture exists. Use the Ensure agent fixture subreddit menu action.'
      );
    if (context.postId !== fixturePostId)
      throw new Error(
        'Open the registered agent fixture post before starting a run.'
      );
    await cleanupPreviousFailure();
    const run: AgentRun = {
      runId: randomUUID(),
      startedAt: new Date().toISOString(),
      status: 'running',
      checks: [],
      artifacts: { serverBuildId: buildId },
      cleanupKeys: [],
    };
    await saveRun(run);
    return run;
  }),

  runCommand: publicProcedure
    .input(
      z.object({
        runId: z.string().uuid(),
        commandId: z.string().min(1),
        input: z.unknown(),
      })
    )
    .mutation(async ({ input }) => {
      const run = await loadRun(input.runId);
      if (run.status !== 'running')
        throw new Error(`Agent run is ${run.status}`);
      try {
        const result = await executeAgentCommand(
          input.commandId,
          input.input,
          run.runId
        );
        run.checks.push(...result.checks);
        run.cleanupKeys.push(...(result.cleanupKeys ?? []));
        Object.assign(run.artifacts, result.artifacts);
        await saveRun(run);
        return run;
      } catch (error) {
        run.status = 'failed';
        run.finishedAt = new Date().toISOString();
        run.error = error instanceof Error ? error.message : String(error);
        await saveRun(run);
        await redis.set(lastFailedRunKey, run.runId);
        throw error;
      }
    }),

  getRun: publicProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ input }) => await loadRun(input.runId)),

  finishRun: publicProcedure
    .input(z.object({ runId: z.string().uuid(), passed: z.boolean() }))
    .mutation(async ({ input }) => {
      const run = await loadRun(input.runId);
      run.status = input.passed ? 'passed' : 'failed';
      run.finishedAt = new Date().toISOString();
      if (run.status === 'passed') await cleanupRun(run);
      else await redis.set(lastFailedRunKey, run.runId);
      await saveRun(run);
      return run;
    }),

  resetRun: publicProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const run = await loadRun(input.runId);
      await cleanupRun(run);
      return run;
    }),
});

export const setAgentFixturePostId = async (postId: string) => {
  await redis.set(fixturePostKey, postId);
};

export const getAgentFixturePostId = async () =>
  await redis.get(fixturePostKey);
