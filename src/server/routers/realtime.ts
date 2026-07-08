import { z } from 'zod';
import { context, realtime, redis } from '@devvit/web/server';
import { router, publicProcedure } from '../trpc';
import {
  BALL_MARGIN,
  BALL_MOVE_MAX_DURATION_MS,
  BALL_MOVE_MIN_DURATION_MS,
  BALL_STALE_MS,
  BALL_WORLD_HEIGHT,
  BALL_WORLD_WIDTH,
  type BallState,
  type RealtimeBallMoveMessage,
  type RealtimeCursorMessage,
} from '../../shared/realtime';

const ballStateSchema = z.object({
  clientId: z.string(),
  userId: z.string(),
  username: z.string(),
  color: z.string(),
  x: z.number(),
  y: z.number(),
  seq: z.number().int(),
  updatedAt: z.number().int(),
});

const ballPointSchema = z.object({
  x: z.number().min(BALL_MARGIN).max(BALL_WORLD_WIDTH - BALL_MARGIN),
  y: z.number().min(BALL_MARGIN).max(BALL_WORLD_HEIGHT - BALL_MARGIN),
});

const clientIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/);

const requirePostId = () => {
  if (!context.postId)
    throw new Error('postId is required but missing from context');
  return context.postId;
};

const requireUser = () => {
  if (!context.userId || !context.username) throw new Error('Must be logged in');
  return { userId: context.userId, username: context.username };
};

const ballsKey = (postId: string) => `balls:${postId}`;

const randomPoint = () => ({
  x:
    BALL_MARGIN +
    Math.round(Math.random() * (BALL_WORLD_WIDTH - BALL_MARGIN * 2)),
  y:
    BALL_MARGIN +
    Math.round(Math.random() * (BALL_WORLD_HEIGHT - BALL_MARGIN * 2)),
});

const randomColor = () => {
  const colors = [
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#14b8a6',
    '#38bdf8',
    '#6366f1',
    '#ec4899',
  ];
  const index = Math.floor(Math.random() * colors.length);
  return colors[index] ?? '#38bdf8';
};

const parseBallState = (value: string): BallState =>
  ballStateSchema.parse(JSON.parse(value));

const readActiveBalls = async (
  key: string,
  now: number
): Promise<BallState[]> => {
  const stored = await redis.hGetAll(key);
  const balls: BallState[] = [];
  const staleClientIds: string[] = [];

  for (const [clientId, value] of Object.entries(stored)) {
    try {
      const ball = parseBallState(value);
      if (now - ball.updatedAt > BALL_STALE_MS) {
        staleClientIds.push(clientId);
      } else {
        balls.push(ball);
      }
    } catch {
      staleClientIds.push(clientId);
    }
  }

  if (staleClientIds.length) await redis.hDel(key, staleClientIds);
  return balls;
};

const movementDuration = (
  from: { x: number; y: number },
  to: { x: number; y: number }
) =>
  Math.round(
    Math.min(
      BALL_MOVE_MAX_DURATION_MS,
      Math.max(
        BALL_MOVE_MIN_DURATION_MS,
        Math.hypot(to.x - from.x, to.y - from.y) * 2.2
      )
    )
  );

export const realtimeRouter = router({
  // realtime.send(): publish a JSON message to every client subscribed to this post's
  // channel via `connectRealtime` on the client. There is no client -> client messaging;
  // every message is relayed through this server call.
  broadcastCursor: publicProcedure
    .input(z.object({ x: z.number(), y: z.number() }))
    .mutation(async ({ input }) => {
      const postId = requirePostId();

      const message: RealtimeCursorMessage = {
        type: 'cursor',
        userId: context.userId ?? 'anonymous',
        username: context.username ?? 'anonymous',
        x: input.x,
        y: input.y,
        sentAt: Date.now(),
      };
      await realtime.send<RealtimeCursorMessage>(postId, message);
      return { success: true };
    }),

  joinBall: publicProcedure
    .input(z.object({ clientId: clientIdSchema }))
    .mutation(async ({ input }) => {
      const postId = requirePostId();
      const { userId, username } = requireUser();
      const key = ballsKey(postId);
      const now = Date.now();
      const balls = await readActiveBalls(key, now);
      const existing = balls.find((ball) => ball.clientId === input.clientId);

      if (existing && existing.userId !== userId) {
        throw new Error('This ball belongs to a different user');
      }

      const self =
        existing ??
        ({
          clientId: input.clientId,
          userId,
          username,
          color: randomColor(),
          ...randomPoint(),
          seq: 0,
          updatedAt: now,
        } satisfies BallState);

      const updatedSelf = { ...self, username, updatedAt: now };
      await redis.hSet(key, { [input.clientId]: JSON.stringify(updatedSelf) });

      const activeBalls = existing
        ? balls.map((ball) =>
            ball.clientId === input.clientId ? updatedSelf : ball
          )
        : [...balls, updatedSelf];

      return { self: updatedSelf, balls: activeBalls };
    }),

  moveBall: publicProcedure
    .input(z.object({ clientId: clientIdSchema, to: ballPointSchema }))
    .mutation(async ({ input }) => {
      const postId = requirePostId();
      const { userId, username } = requireUser();
      const key = ballsKey(postId);
      const raw = await redis.hGet(key, input.clientId);
      if (!raw) throw new Error('Join the movement demo before moving');

      const ball = parseBallState(raw);
      if (ball.userId !== userId) {
        throw new Error('This ball belongs to a different user');
      }

      const now = Date.now();
      const from = { x: ball.x, y: ball.y };
      const to = { x: Math.round(input.to.x), y: Math.round(input.to.y) };
      const seq = ball.seq + 1;
      const next: BallState = {
        ...ball,
        username,
        x: to.x,
        y: to.y,
        seq,
        updatedAt: now,
      };
      const message: RealtimeBallMoveMessage = {
        type: 'ballMove',
        clientId: input.clientId,
        username,
        color: ball.color,
        from,
        to,
        durationMs: movementDuration(from, to),
        seq,
        sentAt: now,
      };

      await redis.hSet(key, { [input.clientId]: JSON.stringify(next) });
      await realtime.send<RealtimeBallMoveMessage>(postId, message);
      return message;
    }),
});
