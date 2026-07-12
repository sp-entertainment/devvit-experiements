import { context, redis } from '@devvit/web/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildId } from '../../shared/buildInfo';
import { executeAgentCommand, listAgentCommands } from '../agent/commands';
import {
  AGENT_RUN_TTL_MS,
  finishAgentRun,
  parseAgentRun,
  type AgentRun,
} from '../agent/run';
import {
  isRedisTransactionConflict,
  redisTransactionConflictError,
  retryRedisTransaction,
} from '../redisTransactionRetry';
import { publicProcedure, router } from '../trpc';

const runKey = (runId: string) => `agent:run:${runId}`;
const lastFailedRunKey = 'agent:last-failed-run';
const fixturePostKey = 'agent:fixture-post-id';
const runExpiration = (): Date => new Date(Date.now() + AGENT_RUN_TTL_MS);

const saveRun = async (run: AgentRun): Promise<void> => {
  await redis.set(runKey(run.runId), JSON.stringify(run), {
    expiration: runExpiration(),
  });
};

const loadRun = async (runId: string): Promise<AgentRun> => {
  const value = await redis.get(runKey(runId));
  if (!value) throw new Error(`Agent run not found: ${runId}`);
  return parseAgentRun(value);
};

const updateRun = async (
  runId: string,
  update: (run: AgentRun) => AgentRun
): Promise<AgentRun> =>
  retryRedisTransaction(async () => {
    const key = runKey(runId);
    const transaction = await redis.watch(key);
    let multiStarted = false;
    try {
      const raw = await redis.get(key);
      if (!raw) throw new Error(`Agent run not found: ${runId}`);
      const run = update(parseAgentRun(raw));
      await transaction.multi();
      multiStarted = true;
      await transaction.set(key, JSON.stringify(run), {
        expiration: runExpiration(),
      });
      const result = await transaction.exec();
      if (result.length === 0) throw redisTransactionConflictError();
      return run;
    } catch (error) {
      try {
        if (multiStarted) await transaction.discard();
        else await transaction.unwatch();
      } catch (cleanupError) {
        if (!isRedisTransactionConflict(error)) {
          console.debug(
            'Unable to clean up the agent run Redis transaction:',
            cleanupError
          );
        }
      }
      throw error;
    }
  });

const setLastFailedRun = async (runId: string): Promise<void> => {
  await redis.set(lastFailedRunKey, runId, { expiration: runExpiration() });
};

const cleanupRun = async (run: AgentRun): Promise<void> => {
  if (run.cleanupKeys.length) await redis.del(...run.cleanupKeys);
  run.cleanupKeys = [];
  run.artifacts.cleanup = 'completed';
  await saveRun(run);
};

const cleanupPreviousFailure = async (): Promise<void> => {
  const failedRunId = await redis.get(lastFailedRunKey);
  if (!failedRunId) return;
  try {
    await cleanupRun(await loadRun(failedRunId));
  } catch (error) {
    console.warn('Unable to load the previous failed agent run:', error);
  } finally {
    await redis.del(lastFailedRunKey);
  }
};

export const agentRouter = router({
  listCommands: publicProcedure.query(() => listAgentCommands()),

  readiness: publicProcedure
    .input(z.object({ expectedBuildId: z.string().min(1).max(64) }))
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
    if (!fixturePostId) {
      throw new Error(
        'No agent fixture exists. Use the Ensure agent fixture subreddit menu action.'
      );
    }
    if (context.postId !== fixturePostId) {
      throw new Error(
        'Open the registered agent fixture post before starting a run.'
      );
    }
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
        commandId: z.string().min(1).max(100),
        input: z.unknown(),
      })
    )
    .mutation(async ({ input }) => {
      let cleanupKeys: string[] = [];
      try {
        const initial = await loadRun(input.runId);
        if (initial.status !== 'running') {
          throw new Error(`Agent run is ${initial.status}`);
        }
        const result = await executeAgentCommand(
          input.commandId,
          input.input,
          input.runId
        );
        cleanupKeys = result.cleanupKeys ?? [];
        return await updateRun(input.runId, (run) => {
          if (run.status !== 'running')
            throw new Error(`Agent run is ${run.status}`);
          run.checks.push(...result.checks);
          run.cleanupKeys.push(...cleanupKeys);
          Object.assign(run.artifacts, result.artifacts);
          return run;
        });
      } catch (error) {
        if (cleanupKeys.length)
          await redis.del(...cleanupKeys).catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        const failed = await updateRun(input.runId, (run) => {
          if (run.status === 'running') {
            run.status = 'failed';
            run.finishedAt = new Date().toISOString();
            run.error = message;
          }
          return run;
        }).catch(() => undefined);
        if (failed?.status === 'failed') await setLastFailedRun(input.runId);
        throw error;
      }
    }),

  getRun: publicProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ input }) => await loadRun(input.runId)),

  finishRun: publicProcedure
    .input(z.object({ runId: z.string().uuid(), passed: z.boolean() }))
    .mutation(async ({ input }) => {
      const run = await updateRun(input.runId, (current) =>
        finishAgentRun(current, input.passed, new Date().toISOString())
      );
      if (run.status === 'passed') {
        try {
          await cleanupRun(run);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const failed = await updateRun(run.runId, (current) => {
            current.status = 'failed';
            current.error = `Cleanup failed: ${message}`;
            return current;
          });
          await setLastFailedRun(failed.runId);
          throw error;
        }
      } else {
        await setLastFailedRun(run.runId);
      }
      return run;
    }),

  resetRun: publicProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const run = await loadRun(input.runId);
      await cleanupRun(run);
      if ((await redis.get(lastFailedRunKey)) === run.runId) {
        await redis.del(lastFailedRunKey);
      }
      return run;
    }),
});

export const setAgentFixturePostId = async (postId: string): Promise<void> => {
  await redis.set(fixturePostKey, postId);
};

export const getAgentFixturePostId = async (): Promise<string | undefined> =>
  await redis.get(fixturePostKey);
