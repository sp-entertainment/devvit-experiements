import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { context, realtime, redis } from '@devvit/web/server';
import {
  REALTIME_STRESS_DURATION_MS,
  REALTIME_STRESS_EXPECTED_MESSAGES,
  REALTIME_STRESS_PHASES,
  type RealtimeStressClientResult,
  type RealtimeStressDataMessage,
  type RealtimeStressLobbySnapshot,
  type RealtimeStressServerSummary,
} from '../../shared/realtimeStress';
import {
  isRedisTransactionConflict,
  redisTransactionConflictError,
  retryRedisTransaction,
} from '../redisTransactionRetry';
import { runRealtimeStress } from '../realtimeStressRunner';
import { publicProcedure, router } from '../trpc';

const LOBBY_TTL_MS = 24 * 60 * 60 * 1_000;
const PENDING_JOIN_TTL_MS = 10_000;
const ACTIVE_LOCK_TTL_MS = 35_000;
const RUN_START_DELAY_MS = 500;
const STALE_RUN_GRACE_MS = 20_000;
const ACTIVE_LOCK_KEY = 'realtime-stress:v2:active-run';

const clientIdSchema = z.string().uuid();

const participantSchema = z.object({
  clientId: clientIdSchema,
  username: z.string().min(1).max(100),
  ready: z.boolean(),
  joinedAt: z.number().int(),
});

const phaseSummarySchema = z.object({
  phaseIndex: z
    .number()
    .int()
    .min(0)
    .max(REALTIME_STRESS_PHASES.length - 1),
  targetRate: z.number().int().positive(),
  attempted: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  firstSentAt: z.number().nullable(),
  lastSentAt: z.number().nullable(),
  sendSpanMs: z.number().nonnegative(),
  averageScheduleLagMs: z.number().nonnegative(),
  maxScheduleLagMs: z.number().nonnegative(),
});

const serverSummarySchema = z.object({
  runId: z.string().uuid(),
  outcome: z.enum(['completed', 'failed']),
  startedAt: z.number().int(),
  endedAt: z.number().int(),
  attempted: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  failedSequences: z.array(
    z.number().int().min(1).max(REALTIME_STRESS_EXPECTED_MESSAGES)
  ),
  phases: z.array(phaseSummarySchema).length(REALTIME_STRESS_PHASES.length),
  actualDurationMs: z.number().nonnegative(),
  sendSpanMs: z.number().nonnegative(),
  averageScheduleLagMs: z.number().nonnegative(),
  maxScheduleLagMs: z.number().nonnegative(),
  sendsPerSecond: z.array(z.number().int().nonnegative()).max(60),
  error: z.string().nullable(),
});

const clientPhaseResultSchema = z.object({
  phaseIndex: z
    .number()
    .int()
    .min(0)
    .max(REALTIME_STRESS_PHASES.length - 1),
  targetRate: z.number().int().positive(),
  received: z.number().int().min(0).max(REALTIME_STRESS_EXPECTED_MESSAGES),
  averageMessagesPerSecond: z.number().min(0).max(10_000),
  deliveryPercent: z.number().min(0).max(100),
  receiptSpanMs: z.number().min(0).max(60_000),
});

const clientResultSchema = z.object({
  runId: z.string().uuid(),
  clientId: clientIdSchema,
  username: z.string().min(1).max(100),
  received: z.number().int().min(0).max(REALTIME_STRESS_EXPECTED_MESSAGES),
  averageMessagesPerSecond: z.number().min(0).max(10_000),
  activeAverageMessagesPerSecond: z.number().min(0).max(10_000),
  receiptSpanAverageMessagesPerSecond: z.number().min(0).max(10_000),
  peakMessagesPerSecond: z.number().int().min(0).max(10_000),
  receiptSpanMs: z.number().min(0).max(60_000),
  receivedPerSecond: z
    .array(z.number().int().min(0).max(REALTIME_STRESS_EXPECTED_MESSAGES))
    .max(60),
  missingAttempts: z
    .number()
    .int()
    .min(0)
    .max(REALTIME_STRESS_EXPECTED_MESSAGES),
  deliveryMissing: z
    .number()
    .int()
    .min(0)
    .max(REALTIME_STRESS_EXPECTED_MESSAGES),
  duplicates: z.number().int().min(0).max(100_000),
  outOfOrder: z.number().int().min(0).max(REALTIME_STRESS_EXPECTED_MESSAGES),
  disconnects: z.number().int().min(0).max(1_000),
  phases: z
    .array(clientPhaseResultSchema)
    .length(REALTIME_STRESS_PHASES.length),
  submittedAt: z.number().int(),
});

const runSchema = z.object({
  runId: z.string().uuid(),
  startedAt: z.number().int(),
  endsAt: z.number().int(),
  participantIds: z.array(clientIdSchema).min(1),
});

const lobbySchema = z.object({
  version: z.literal(2),
  lobbyId: z.string().uuid(),
  postId: z.string().min(1),
  channel: z.string().regex(/^[a-zA-Z0-9_]+$/),
  status: z.enum(['idle', 'running', 'completed', 'failed']),
  participants: z.record(z.string(), participantSchema),
  run: runSchema.nullable(),
  summary: serverSummarySchema.nullable(),
  results: z.record(z.string(), clientResultSchema),
  updatedAt: z.number().int(),
});

type LobbyState = z.infer<typeof lobbySchema>;

type LobbyMutation<T> = (
  current: LobbyState | undefined,
  now: number
) => { state: LobbyState; value: T };

const requirePostId = (): string => {
  if (!context.postId)
    throw new Error('postId is required but missing from context');
  return context.postId;
};

const requireUsername = (): string => {
  if (!context.username) throw new Error('Must be logged in');
  return context.username;
};

const lobbyKey = (postId: string): string =>
  `realtime-stress:v2:lobby:${postId}`;

const newChannel = (): string =>
  `realtime_stress_${randomUUID().replaceAll('-', '_')}`;

const createLobby = (postId: string, now: number): LobbyState => ({
  version: 2,
  lobbyId: randomUUID(),
  postId,
  channel: newChannel(),
  status: 'idle',
  participants: {},
  run: null,
  summary: null,
  results: {},
  updatedAt: now,
});

const parseLobby = (raw: string): LobbyState =>
  lobbySchema.parse(JSON.parse(raw));

const mutateLobby = async <T>(
  postId: string,
  mutation: LobbyMutation<T>
): Promise<T> =>
  retryRedisTransaction(async () => {
    const key = lobbyKey(postId);
    const transaction = await redis.watch(key);
    let multiStarted = false;
    try {
      const raw = await redis.get(key);
      const now = Date.now();
      const decision = mutation(raw ? parseLobby(raw) : undefined, now);
      decision.state.updatedAt = now;
      await transaction.multi();
      multiStarted = true;
      await transaction.set(key, JSON.stringify(decision.state), {
        expiration: new Date(now + LOBBY_TTL_MS),
      });
      const result = await transaction.exec();
      if (result.length === 0) throw redisTransactionConflictError();
      return decision.value;
    } catch (error) {
      try {
        if (multiStarted) await transaction.discard();
        else await transaction.unwatch();
      } catch (cleanupError) {
        if (!isRedisTransactionConflict(error)) {
          console.debug(
            'Unable to clean up stress-test transaction:',
            cleanupError
          );
        }
      }
      throw error;
    }
  });

const readLobby = async (postId: string): Promise<LobbyState | undefined> => {
  const raw = await redis.get(lobbyKey(postId));
  return raw ? parseLobby(raw) : undefined;
};

const activeParticipants = (state: LobbyState) =>
  Object.values(state.participants).sort(
    (left, right) => left.joinedAt - right.joinedAt
  );

const snapshot = (
  state: LobbyState | undefined,
  now: number
): RealtimeStressLobbySnapshot => {
  if (!state) {
    return {
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
      serverNow: now,
    };
  }

  const participants = activeParticipants(state);
  return {
    status: state.status,
    lobbyId: state.lobbyId,
    participants,
    readyCount: participants.filter((participant) => participant.ready).length,
    pendingCount: participants.filter((participant) => !participant.ready)
      .length,
    runId: state.run?.runId ?? null,
    startedAt: state.run?.startedAt ?? null,
    endsAt: state.run?.endsAt ?? null,
    summary: state.summary,
    results: Object.values(state.results).sort(
      (left, right) => left.submittedAt - right.submittedAt
    ),
    serverNow: now,
  };
};

const lockValue = (postId: string, runId: string): string =>
  `${postId}|${runId}`;

const releaseActiveLock = async (expectedValue: string): Promise<void> => {
  await retryRedisTransaction(async () => {
    const transaction = await redis.watch(ACTIVE_LOCK_KEY);
    let multiStarted = false;
    try {
      const current = await redis.get(ACTIVE_LOCK_KEY);
      if (current !== expectedValue) {
        await transaction.unwatch();
        return;
      }
      await transaction.multi();
      multiStarted = true;
      await transaction.del(ACTIVE_LOCK_KEY);
      const result = await transaction.exec();
      if (result.length === 0) throw redisTransactionConflictError();
    } catch (error) {
      try {
        if (multiStarted) await transaction.discard();
        else await transaction.unwatch();
      } catch {
        // The lock also has a hard expiration, so cleanup failure is recoverable.
      }
      throw error;
    }
  });
};

const failedSummary = (
  runId: string,
  startedAt: number,
  error: unknown
): RealtimeStressServerSummary => ({
  runId,
  outcome: 'failed',
  startedAt,
  endedAt: Date.now(),
  attempted: 0,
  succeeded: 0,
  rejected: 0,
  failedSequences: [],
  phases: REALTIME_STRESS_PHASES.map((phase) => ({
    phaseIndex: phase.index,
    targetRate: phase.targetRate,
    attempted: 0,
    succeeded: 0,
    rejected: 0,
    firstSentAt: null,
    lastSentAt: null,
    sendSpanMs: 0,
    averageScheduleLagMs: 0,
    maxScheduleLagMs: 0,
  })),
  actualDurationMs: Math.max(0, Date.now() - startedAt),
  sendSpanMs: 0,
  averageScheduleLagMs: 0,
  maxScheduleLagMs: 0,
  sendsPerSecond: [],
  error: error instanceof Error ? error.message : String(error),
});

const finalizeRun = async (
  postId: string,
  runId: string,
  summary: RealtimeStressServerSummary
): Promise<void> => {
  await mutateLobby(postId, (current) => {
    if (!current || current.run?.runId !== runId) {
      throw new Error('Stress-test run is no longer current');
    }
    current.status = summary.outcome === 'completed' ? 'completed' : 'failed';
    current.summary = summary;
    return { state: current, value: undefined };
  });
};

const recoverStaleRun = async (
  postId: string,
  state: LobbyState
): Promise<LobbyState> => {
  if (
    state.status !== 'running' ||
    !state.run ||
    Date.now() <= state.run.endsAt + STALE_RUN_GRACE_MS
  ) {
    return state;
  }

  await finalizeRun(
    postId,
    state.run.runId,
    failedSummary(state.run.runId, state.run.startedAt, 'Run timed out')
  );
  return (await readLobby(postId)) ?? state;
};

const pruneStalePendingParticipants = async (
  postId: string,
  state: LobbyState
): Promise<LobbyState> => {
  if (state.status !== 'idle') return state;
  const now = Date.now();
  const hasStalePending = Object.values(state.participants).some(
    (participant) =>
      !participant.ready && now - participant.joinedAt > PENDING_JOIN_TTL_MS
  );
  if (!hasStalePending) return state;

  await mutateLobby(postId, (current, mutationNow) => {
    if (
      !current ||
      current.lobbyId !== state.lobbyId ||
      current.status !== 'idle'
    ) {
      return {
        state: current ?? createLobby(postId, mutationNow),
        value: undefined,
      };
    }
    for (const [clientId, participant] of Object.entries(
      current.participants
    )) {
      if (
        !participant.ready &&
        mutationNow - participant.joinedAt > PENDING_JOIN_TTL_MS
      ) {
        delete current.participants[clientId];
      }
    }
    return { state: current, value: undefined };
  });
  return (await readLobby(postId)) ?? state;
};

export const realtimeStressRouter = router({
  join: publicProcedure
    .input(z.object({ clientId: clientIdSchema }))
    .mutation(async ({ input }) => {
      const postId = requirePostId();
      const username = requireUsername();
      return await mutateLobby(postId, (current, now) => {
        const state = current ?? createLobby(postId, now);
        if (state.status !== 'idle') {
          throw new Error('This stress test has already started');
        }
        state.participants[input.clientId] = {
          clientId: input.clientId,
          username,
          ready: false,
          joinedAt: now,
        };
        return {
          state,
          value: {
            channel: state.channel,
            lobbyId: state.lobbyId,
            username,
          },
        };
      });
    }),

  ready: publicProcedure
    .input(z.object({ clientId: clientIdSchema, lobbyId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const postId = requirePostId();
      return await mutateLobby(postId, (current) => {
        if (!current || current.lobbyId !== input.lobbyId) {
          throw new Error('Stress-test lobby changed; join again');
        }
        if (current.status !== 'idle') {
          throw new Error('The participant roster is already frozen');
        }
        const participant = current.participants[input.clientId];
        if (!participant) throw new Error('Join the stress test first');
        participant.ready = true;
        return { state: current, value: snapshot(current, Date.now()) };
      });
    }),

  leave: publicProcedure
    .input(z.object({ clientId: clientIdSchema, lobbyId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const postId = requirePostId();
      return await mutateLobby(postId, (current) => {
        if (!current || current.lobbyId !== input.lobbyId) {
          throw new Error('Stress-test lobby is no longer current');
        }
        if (current.status !== 'idle') return { state: current, value: false };
        delete current.participants[input.clientId];
        return { state: current, value: true };
      });
    }),

  status: publicProcedure.query(async () => {
    const postId = requirePostId();
    const stored = await readLobby(postId);
    const recovered = stored
      ? await recoverStaleRun(postId, stored)
      : undefined;
    const state = recovered
      ? await pruneStalePendingParticipants(postId, recovered)
      : undefined;
    return snapshot(state, Date.now());
  }),

  start: publicProcedure
    .input(z.object({ clientId: clientIdSchema, lobbyId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const postId = requirePostId();
      const runId = randomUUID();
      const ownedLockValue = lockValue(postId, runId);
      const acquired = await redis.set(ACTIVE_LOCK_KEY, ownedLockValue, {
        nx: true,
        expiration: new Date(Date.now() + ACTIVE_LOCK_TTL_MS),
      });
      if (!acquired) {
        throw new Error(
          'Another stress test is already running in this installation'
        );
      }

      let startedAt = Date.now() + RUN_START_DELAY_MS;
      let channel = '';
      try {
        const startState = await mutateLobby(postId, (current, now) => {
          if (!current || current.lobbyId !== input.lobbyId) {
            throw new Error('Stress-test lobby changed; join again');
          }
          if (current.status !== 'idle') {
            throw new Error('This stress test has already started');
          }

          for (const [clientId, participant] of Object.entries(
            current.participants
          )) {
            if (
              !participant.ready &&
              now - participant.joinedAt > PENDING_JOIN_TTL_MS
            ) {
              delete current.participants[clientId];
            }
          }

          const participants = activeParticipants(current);
          const caller = current.participants[input.clientId];
          if (!caller?.ready)
            throw new Error('Join the stress test before starting');
          if (participants.some((participant) => !participant.ready)) {
            throw new Error('Wait for pending clients to finish joining');
          }
          if (participants.length === 0) {
            throw new Error('At least one client must join before starting');
          }

          startedAt = now + RUN_START_DELAY_MS;
          channel = current.channel;
          current.status = 'running';
          current.run = {
            runId,
            startedAt,
            endsAt: startedAt + REALTIME_STRESS_DURATION_MS,
            participantIds: participants.map(
              (participant) => participant.clientId
            ),
          };
          current.summary = null;
          current.results = {};
          return { state: current, value: snapshot(current, now) };
        });

        console.info(
          'Realtime stress test started:',
          runId,
          startState.readyCount,
          'clients'
        );
        const summary = await runRealtimeStress({
          channel,
          runId,
          startedAt,
          send: async (targetChannel, message: RealtimeStressDataMessage) => {
            await realtime.send<RealtimeStressDataMessage>(
              targetChannel,
              message
            );
          },
        });
        await finalizeRun(postId, runId, summary);
        console.info(
          'Realtime stress test completed:',
          runId,
          summary.succeeded,
          'succeeded,',
          summary.rejected,
          'rejected'
        );
        return summary;
      } catch (error) {
        const state = await readLobby(postId).catch(() => undefined);
        if (state?.run?.runId === runId && state.status === 'running') {
          await finalizeRun(
            postId,
            runId,
            failedSummary(runId, startedAt, error)
          ).catch((finalizeError) => {
            console.error(
              'Failed to record stress-test failure:',
              finalizeError
            );
          });
        }
        throw error;
      } finally {
        await releaseActiveLock(ownedLockValue).catch((error) => {
          console.warn(
            'Failed to release stress-test installation lock:',
            error
          );
        });
      }
    }),

  submitResult: publicProcedure
    .input(clientResultSchema)
    .mutation(async ({ input }) => {
      const postId = requirePostId();
      const username = requireUsername();
      return await mutateLobby(postId, (current) => {
        if (!current?.run || current.run.runId !== input.runId) {
          throw new Error('Stress-test run is no longer current');
        }
        if (current.status !== 'completed' && current.status !== 'failed') {
          throw new Error('Stress test has not finished');
        }
        if (!current.run.participantIds.includes(input.clientId)) {
          throw new Error('Only joined clients can submit results');
        }
        const result: RealtimeStressClientResult = {
          ...input,
          username,
          submittedAt: Date.now(),
        };
        current.results[input.clientId] = result;
        return { state: current, value: result };
      });
    }),

  reset: publicProcedure.mutation(async () => {
    const postId = requirePostId();
    return await mutateLobby(postId, (current, now) => {
      if (current?.status === 'running') {
        throw new Error('Cannot reset a running stress test');
      }
      const state = createLobby(postId, now);
      return { state, value: snapshot(state, now) };
    });
  }),
});
