import { randomUUID } from 'node:crypto';

import { context, realtime, redis } from '@devvit/web/server';
import { z } from 'zod';

import {
  PONG_GAME_STATE_VERSION,
  PONG_ROOM_TTL_SECONDS,
  PONG_WIN_SCORE,
  advancePongGame,
  createPongGameState,
  joinPongPlayer,
  leavePongPlayer,
  pongGameKey,
  requestPongRematch,
  setPongPlayerInput,
  type PongGameState,
  type PongJoinResult,
  type PongLeaveResult,
  type PongRematchResult,
  type PongSnapshot,
  type PongSyncRejectionReason,
  type PongSyncResult,
  type RealtimePongStateMessage,
} from '../../shared/pong';
import {
  isRedisTransactionConflict,
  redisTransactionConflictError,
  retryRedisTransaction,
} from '../redisTransactionRetry';
import { publicProcedure, router } from '../trpc';

const syncInputSchema = z.object({
  matchId: z.string().min(1),
  inputSeq: z.number().int().min(0),
  axis: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

const pongSideSchema = z.enum(['left', 'right']);
const pongAxisSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
const pongPlayerSchema = z.object({
  playerId: z.string(),
  username: z.string(),
  side: pongSideSchema,
  score: z.number().int().min(0).max(PONG_WIN_SCORE),
  axis: pongAxisSchema,
  inputSeq: z.number().int().min(0),
  lastSeenAt: z.number().int(),
  rematchReady: z.boolean(),
});
const pongPaddleSchema = z.object({ y: z.number() });
const pongBallSchema = z.object({
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
});
const pongCountdownSchema = z.object({
  kind: z.enum(['match', 'point', 'resume']),
  endsAt: z.number().int(),
  launchVx: z.number(),
  launchVy: z.number(),
});
const pongVelocitySchema = z.object({ vx: z.number(), vy: z.number() });
const pongStateSchema = z.object({
  schemaVersion: z.literal(PONG_GAME_STATE_VERSION),
  version: z.number().int().min(0),
  matchId: z.string(),
  phase: z.enum(['lobby', 'countdown', 'playing', 'paused', 'finished']),
  players: z.object({
    left: pongPlayerSchema.nullable(),
    right: pongPlayerSchema.nullable(),
  }),
  paddles: z.object({
    left: pongPaddleSchema,
    right: pongPaddleSchema,
  }),
  ball: pongBallSchema,
  simulatedAt: z.number().int(),
  stepRemainderMs: z.number().min(0),
  countdown: pongCountdownSchema.nullable(),
  pausedAt: z.number().int().nullable(),
  reconnectDeadlineAt: z.number().int().nullable(),
  pausedVelocity: pongVelocitySchema.nullable(),
  winnerPlayerId: z.string().nullable(),
  finishReason: z.enum(['score', 'forfeit']).nullable(),
  nextServeSide: pongSideSchema,
  serveVerticalSign: z.union([z.literal(-1), z.literal(1)]),
});

const requirePostId = (): string => {
  if (!context.postId)
    throw new Error('postId is required but missing from context');
  return context.postId;
};

const requireUser = (): { playerId: string; username: string } => {
  if (!context.userId || !context.username)
    throw new Error('Must be logged in');
  return { playerId: context.userId, username: context.username };
};

const parseState = (raw: string): PongGameState =>
  pongStateSchema.parse(JSON.parse(raw));

type StateMutationDecision<T> = {
  changed: boolean;
  state: PongGameState;
  value: T;
};

type StateMutationResult<T> = {
  state: PongGameState;
  value: T;
};

const broadcastState = async (
  postId: string,
  state: PongGameState
): Promise<void> => {
  const message: RealtimePongStateMessage = {
    type: 'pongState',
    state,
    sentAt: Date.now(),
  };

  await realtime
    .send<RealtimePongStateMessage>(postId, message)
    .catch((error) => {
      console.warn('Failed to broadcast Pong state:', error);
    });
};

const mutateState = async <T>(
  postId: string,
  mutate: (state: PongGameState, attemptNow: number) => StateMutationDecision<T>
): Promise<StateMutationResult<T>> =>
  retryRedisTransaction(async () => {
    const key = pongGameKey(postId);
    const transaction = await redis.watch(key);
    let multiStarted = false;

    try {
      const raw = await redis.get(key);
      const attemptNow = Date.now();
      const current = raw
        ? parseState(raw)
        : createPongGameState(randomUUID(), attemptNow);
      const decision = mutate(current, attemptNow);

      const needsInitialWrite = raw === undefined;
      if (!decision.changed && !needsInitialWrite) {
        await transaction.unwatch();
        return { state: current, value: decision.value };
      }

      const next: PongGameState = {
        ...decision.state,
        version: current.version + 1,
      };
      await transaction.multi();
      multiStarted = true;
      await transaction.set(key, JSON.stringify(next), {
        expiration: new Date(attemptNow + PONG_ROOM_TTL_SECONDS * 1_000),
      });
      const result = await transaction.exec();

      if (result.length === 0) throw redisTransactionConflictError();

      await broadcastState(postId, next);
      return { state: next, value: decision.value };
    } catch (error) {
      try {
        if (multiStarted) await transaction.discard();
        else await transaction.unwatch();
      } catch (cleanupError) {
        if (!isRedisTransactionConflict(error)) {
          console.debug(
            'Unable to clean up the failed Pong Redis transaction:',
            cleanupError
          );
        }
      }
      throw error;
    }
  });

const snapshotResult = (
  state: PongGameState,
  serverNow: number
): PongSnapshot => ({
  state,
  selfPlayerId: context.userId ?? null,
  serverNow,
});

const readState = async (
  postId: string,
  now: number
): Promise<PongGameState> => {
  const raw = await redis.get(pongGameKey(postId));
  return raw ? parseState(raw) : createPongGameState(randomUUID(), now);
};

const advance = (state: PongGameState, now: number): PongGameState =>
  advancePongGame(state, now);

const changedFrom = (current: PongGameState, next: PongGameState): boolean =>
  next !== current;

export const pongRouter = router({
  snapshot: publicProcedure.query(async (): Promise<PongSnapshot> => {
    const now = Date.now();
    const state = await readState(requirePostId(), now);
    return snapshotResult(state, Date.now());
  }),

  join: publicProcedure.mutation(async (): Promise<PongJoinResult> => {
    const postId = requirePostId();
    const { playerId, username } = requireUser();
    const result = await mutateState<{ joined: boolean }>(
      postId,
      (state, attemptNow) => {
        const advanced = advance(state, attemptNow);
        const next = joinPongPlayer(advanced, playerId, username, attemptNow);
        return {
          changed: changedFrom(state, next),
          state: next,
          value: {
            joined:
              next.players.left?.playerId === playerId ||
              next.players.right?.playerId === playerId,
          },
        };
      }
    );

    return {
      ...snapshotResult(result.state, Date.now()),
      joined: result.value.joined,
    };
  }),

  sync: publicProcedure
    .input(syncInputSchema)
    .mutation(async ({ input }): Promise<PongSyncResult> => {
      const postId = requirePostId();
      const { playerId } = requireUser();
      const result = await mutateState<
        | { accepted: true }
        | { accepted: false; reason: PongSyncRejectionReason }
      >(postId, (state, attemptNow) => {
        const advanced = advance(state, attemptNow);

        if (advanced.matchId !== input.matchId) {
          return {
            changed: changedFrom(state, advanced),
            state: advanced,
            value: { accepted: false, reason: 'stale-match' },
          };
        }

        const side =
          advanced.players.left?.playerId === playerId
            ? 'left'
            : advanced.players.right?.playerId === playerId
              ? 'right'
              : null;
        if (!side) {
          return {
            changed: changedFrom(state, advanced),
            state: advanced,
            value: { accepted: false, reason: 'not-player' },
          };
        }

        const next = setPongPlayerInput(
          advanced,
          playerId,
          input.inputSeq,
          input.axis,
          attemptNow
        );
        const player = advanced.players[side];
        if (!player) {
          return {
            changed: changedFrom(state, advanced),
            state: advanced,
            value: { accepted: false, reason: 'not-player' },
          };
        }
        const accepted =
          input.inputSeq > player.inputSeq ||
          (input.inputSeq === player.inputSeq && input.axis === player.axis);
        return {
          changed: changedFrom(state, next),
          state: next,
          value: accepted
            ? { accepted: true }
            : { accepted: false, reason: 'stale-input' },
        };
      });
      const snapshot = snapshotResult(result.state, Date.now());

      return result.value.accepted
        ? { ...snapshot, accepted: true }
        : { ...snapshot, accepted: false, reason: result.value.reason };
    }),

  leave: publicProcedure.mutation(async (): Promise<PongLeaveResult> => {
    const postId = requirePostId();
    const { playerId } = requireUser();
    const result = await mutateState<{ left: boolean }>(
      postId,
      (state, attemptNow) => {
        const advanced = advance(state, attemptNow);
        const wasPlayer =
          advanced.players.left?.playerId === playerId ||
          advanced.players.right?.playerId === playerId;
        const next = leavePongPlayer(advanced, playerId, attemptNow);
        return {
          changed: changedFrom(state, next),
          state: next,
          value: { left: wasPlayer },
        };
      }
    );

    return {
      ...snapshotResult(result.state, Date.now()),
      left: result.value.left,
    };
  }),

  requestRematch: publicProcedure.mutation(
    async (): Promise<PongRematchResult> => {
      const postId = requirePostId();
      const { playerId } = requireUser();
      const result = await mutateState<{ accepted: boolean }>(
        postId,
        (state, attemptNow) => {
          const advanced = advance(state, attemptNow);
          const wasFinished = advanced.phase === 'finished';
          const isPlayer =
            advanced.players.left?.playerId === playerId ||
            advanced.players.right?.playerId === playerId;
          const next = requestPongRematch(advanced, playerId, attemptNow);
          return {
            changed: changedFrom(state, next),
            state: next,
            value: { accepted: wasFinished && isPlayer },
          };
        }
      );

      return {
        ...snapshotResult(result.state, Date.now()),
        accepted: result.value.accepted,
      };
    }
  ),
});
