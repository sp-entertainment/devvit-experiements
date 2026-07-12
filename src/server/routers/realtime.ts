import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { context, realtime, redis } from '@devvit/web/server';
import { authenticatedProcedure, publicProcedure, router } from '../trpc';
import {
  BALL_MARGIN,
  BALL_MOVE_MAX_DURATION_MS,
  BALL_STALE_MS,
  BALL_WORLD_HEIGHT,
  BALL_WORLD_WIDTH,
  CANVAS_CELL_SIZE,
  CANVAS_COLORS,
  CANVAS_ERASER_MAX_RADIUS,
  CANVAS_ERASER_MIN_RADIUS,
  CANVAS_GRID_COLS,
  CANVAS_GRID_ROWS,
  CANVAS_MAX_TEXT_LENGTH,
  CANVAS_WORLD_HEIGHT,
  CANVAS_WORLD_WIDTH,
  ballMoveMessageFromState,
  ballMovementDuration,
  sharedCanvasKey,
  smoothMovementBallsKey,
  type BallState,
  type CanvasItem,
  type RealtimeBallMoveMessage,
  type RealtimeCanvasEraseMessage,
  type RealtimeCanvasPutMessage,
  type RealtimeCursorMessage,
} from '../../shared/realtime';

const ballPointSchema = z.object({
  x: z
    .number()
    .min(BALL_MARGIN)
    .max(BALL_WORLD_WIDTH - BALL_MARGIN),
  y: z
    .number()
    .min(BALL_MARGIN)
    .max(BALL_WORLD_HEIGHT - BALL_MARGIN),
});

const ballStateSchema = z.object({
  playerId: z.string(),
  userId: z.string(),
  username: z.string(),
  color: z.string(),
  from: ballPointSchema,
  to: ballPointSchema,
  durationMs: z.number().int().min(0).max(BALL_MOVE_MAX_DURATION_MS),
  moveStartedAt: z.number().int(),
  seq: z.number().int(),
  updatedAt: z.number().int(),
});

const colorSchema = z
  .string()
  .refine((color) => CANVAS_COLORS.includes(color), {
    message: 'Unsupported canvas color',
  });

const canvasPixelItemSchema = z.object({
  kind: z.literal('pixel'),
  id: z.string(),
  userId: z.string(),
  username: z.string(),
  color: colorSchema,
  col: z
    .number()
    .int()
    .min(0)
    .max(CANVAS_GRID_COLS - 1),
  row: z
    .number()
    .int()
    .min(0)
    .max(CANVAS_GRID_ROWS - 1),
  updatedAt: z.number().int(),
});

const canvasTextItemSchema = z.object({
  kind: z.literal('text'),
  id: z.string(),
  userId: z.string(),
  username: z.string(),
  color: colorSchema,
  x: z.number().min(0).max(CANVAS_WORLD_WIDTH),
  y: z.number().min(0).max(CANVAS_WORLD_HEIGHT),
  text: z.string().min(1).max(CANVAS_MAX_TEXT_LENGTH),
  updatedAt: z.number().int(),
});

const canvasItemSchema = z.discriminatedUnion('kind', [
  canvasPixelItemSchema,
  canvasTextItemSchema,
]);

const requirePostId = () => {
  if (!context.postId)
    throw new Error('postId is required but missing from context');
  return context.postId;
};

const requireUser = () => {
  if (!context.userId || !context.username)
    throw new Error('Must be logged in');
  return {
    playerId: context.userId,
    userId: context.userId,
    username: context.username,
  };
};

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

const createBall = (
  playerId: string,
  userId: string,
  username: string,
  now: number
): BallState => {
  const point = randomPoint();
  return {
    playerId,
    userId,
    username,
    color: randomColor(),
    from: point,
    to: point,
    durationMs: 0,
    moveStartedAt: now,
    seq: now,
    updatedAt: now,
  };
};

const parseBallState = (value: string): BallState => {
  const parsed = JSON.parse(value);
  return ballStateSchema.parse(parsed);
};

const writeBallState = async (
  key: string,
  playerId: string,
  getNext: (current: BallState | undefined) => BallState
) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const txn = await redis.watch(key);
    const raw = await redis.hGet(key, playerId);
    let next: BallState;

    try {
      next = getNext(raw ? parseBallState(raw) : undefined);
    } catch (error) {
      await txn.unwatch();
      throw error;
    }

    await txn.multi();
    await txn.hSet(key, { [playerId]: JSON.stringify(next) });
    const result = await txn.exec();
    if (result.length > 0) return next;
  }

  throw new Error('Movement update conflicted; retry');
};

const parseCanvasItem = (value: string): CanvasItem =>
  canvasItemSchema.parse(JSON.parse(value));

const readActiveBalls = async (
  key: string,
  now: number
): Promise<BallState[]> => {
  const stored = await redis.hGetAll(key);
  const balls: BallState[] = [];
  const stalePlayerIds: string[] = [];

  for (const [playerId, value] of Object.entries(stored)) {
    try {
      const ball = parseBallState(value);
      if (ball.playerId !== playerId || now - ball.updatedAt > BALL_STALE_MS) {
        stalePlayerIds.push(playerId);
      } else {
        balls.push(ball);
      }
    } catch {
      stalePlayerIds.push(playerId);
    }
  }

  if (stalePlayerIds.length) await redis.hDel(key, stalePlayerIds);
  return balls;
};

const sendBallMove = async (
  postId: string,
  message: RealtimeBallMoveMessage
) => {
  await realtime
    .send<RealtimeBallMoveMessage>(postId, message)
    .catch((error) => {
      console.error('Failed to broadcast ball move:', error);
    });
};

const readCanvasItems = async (key: string): Promise<CanvasItem[]> => {
  const stored = await redis.hGetAll(key);
  const items: CanvasItem[] = [];
  const badIds: string[] = [];

  for (const [id, value] of Object.entries(stored)) {
    try {
      const item = parseCanvasItem(value);
      if (item.id === id) {
        items.push(item);
      } else {
        badIds.push(id);
      }
    } catch {
      badIds.push(id);
    }
  }

  if (badIds.length) await redis.hDel(key, badIds);
  return items;
};

const distanceToRect = (
  x: number,
  y: number,
  left: number,
  top: number,
  right: number,
  bottom: number
) => {
  const dx = Math.max(left - x, 0, x - right);
  const dy = Math.max(top - y, 0, y - bottom);
  return Math.hypot(dx, dy);
};

const isWithinErase = (
  item: CanvasItem,
  point: { x: number; y: number },
  radius: number
) => {
  if (item.kind === 'pixel') {
    const x = (item.col + 0.5) * CANVAS_CELL_SIZE;
    const y = (item.row + 0.5) * CANVAS_CELL_SIZE;
    return Math.hypot(point.x - x, point.y - y) <= radius;
  }

  const width = Math.max(24, item.text.length * 13);
  return (
    distanceToRect(
      point.x,
      point.y,
      item.x,
      item.y - 14,
      item.x + width,
      item.y + 14
    ) <= radius
  );
};

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

  joinBall: authenticatedProcedure.mutation(async () => {
    const postId = requirePostId();
    const { playerId, userId, username } = requireUser();
    const key = smoothMovementBallsKey(postId);
    const now = Date.now();

    const self = await writeBallState(key, playerId, (current) => ({
      ...(current ?? createBall(playerId, userId, username, now)),
      username,
      updatedAt: now,
    }));
    const activeBalls = await readActiveBalls(key, now);

    await sendBallMove(postId, ballMoveMessageFromState(self, now));

    return {
      selfPlayerId: playerId,
      moves: activeBalls.map((ball) => ballMoveMessageFromState(ball, now)),
    };
  }),

  moveBall: authenticatedProcedure
    .input(z.object({ to: ballPointSchema }))
    .mutation(async ({ input }) => {
      const postId = requirePostId();
      const { playerId, userId, username } = requireUser();
      const key = smoothMovementBallsKey(postId);
      const now = Date.now();
      const to = { x: Math.round(input.to.x), y: Math.round(input.to.y) };

      const next = await writeBallState(key, playerId, (current) => {
        const ball = current ?? createBall(playerId, userId, username, now);
        const from = ballMoveMessageFromState(ball, now).from;
        const stillMoving =
          ball.durationMs > 0 && now - ball.moveStartedAt < ball.durationMs;

        if (stillMoving) {
          throw new Error('Wait for the current move to finish');
        }

        return {
          ...ball,
          username,
          from,
          to,
          durationMs: ballMovementDuration(from, to),
          moveStartedAt: now,
          seq: ball.seq + 1,
          updatedAt: now,
        };
      });
      const message = ballMoveMessageFromState(next, now);

      await sendBallMove(postId, message);
      return message;
    }),

  ballSnapshot: publicProcedure.query(async () => {
    const now = Date.now();
    const balls = await readActiveBalls(
      smoothMovementBallsKey(requirePostId()),
      now
    );
    return {
      moves: balls.map((ball) => ballMoveMessageFromState(ball, now)),
    };
  }),

  canvas: router({
    snapshot: publicProcedure.query(async () => {
      return { items: await readCanvasItems(sharedCanvasKey(requirePostId())) };
    }),

    putPixel: authenticatedProcedure
      .input(
        z.object({
          col: z
            .number()
            .int()
            .min(0)
            .max(CANVAS_GRID_COLS - 1),
          row: z
            .number()
            .int()
            .min(0)
            .max(CANVAS_GRID_ROWS - 1),
          color: colorSchema,
        })
      )
      .mutation(async ({ input }) => {
        const postId = requirePostId();
        const { userId, username } = requireUser();
        const now = Date.now();
        const item: CanvasItem = {
          kind: 'pixel',
          id: `p:${input.col}:${input.row}`,
          userId,
          username,
          color: input.color,
          col: input.col,
          row: input.row,
          updatedAt: now,
        };
        const message: RealtimeCanvasPutMessage = {
          type: 'canvasPut',
          item,
          sentAt: now,
        };

        await redis.hSet(sharedCanvasKey(postId), {
          [item.id]: JSON.stringify(item),
        });
        await realtime.send<RealtimeCanvasPutMessage>(postId, message);
        return { item };
      }),

    putText: authenticatedProcedure
      .input(
        z.object({
          x: z.number().min(0).max(CANVAS_WORLD_WIDTH),
          y: z.number().min(0).max(CANVAS_WORLD_HEIGHT),
          text: z.string().trim().min(1).max(CANVAS_MAX_TEXT_LENGTH),
          color: colorSchema,
        })
      )
      .mutation(async ({ input }) => {
        const postId = requirePostId();
        const { userId, username } = requireUser();
        const now = Date.now();
        const item: CanvasItem = {
          kind: 'text',
          id: `t:${now}:${randomUUID()}`,
          userId,
          username,
          color: input.color,
          x: Math.round(input.x),
          y: Math.round(input.y),
          text: input.text,
          updatedAt: now,
        };
        const message: RealtimeCanvasPutMessage = {
          type: 'canvasPut',
          item,
          sentAt: now,
        };

        await redis.hSet(sharedCanvasKey(postId), {
          [item.id]: JSON.stringify(item),
        });
        await realtime.send<RealtimeCanvasPutMessage>(postId, message);
        return { item };
      }),

    eraseAt: authenticatedProcedure
      .input(
        z.object({
          x: z.number().min(0).max(CANVAS_WORLD_WIDTH),
          y: z.number().min(0).max(CANVAS_WORLD_HEIGHT),
          radius: z
            .number()
            .min(CANVAS_ERASER_MIN_RADIUS)
            .max(CANVAS_ERASER_MAX_RADIUS),
        })
      )
      .mutation(async ({ input }) => {
        const postId = requirePostId();
        const key = sharedCanvasKey(postId);
        const items = await readCanvasItems(key);
        const ids = items
          .filter((item) => isWithinErase(item, input, input.radius))
          .map((item) => item.id);

        if (ids.length) {
          const now = Date.now();
          const message: RealtimeCanvasEraseMessage = {
            type: 'canvasErase',
            ids,
            sentAt: now,
          };

          await redis.hDel(key, ids);
          await realtime.send<RealtimeCanvasEraseMessage>(postId, message);
        }

        return { ids };
      }),
  }),
});
