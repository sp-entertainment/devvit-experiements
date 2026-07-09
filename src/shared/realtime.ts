export const BALL_WORLD_WIDTH = 1024;
export const BALL_WORLD_HEIGHT = 768;
export const BALL_MARGIN = 36;
export const BALL_STALE_MS = 120_000;
export const BALL_MOVE_MIN_DURATION_MS = 450;
export const BALL_MOVE_MAX_DURATION_MS = 1_400;
export const SMOOTH_MOVEMENT_STATE_VERSION = 3;

export const CANVAS_WORLD_WIDTH = 1024;
export const CANVAS_WORLD_HEIGHT = 768;
export const CANVAS_GRID_COLS = 64;
export const CANVAS_GRID_ROWS = 48;
export const CANVAS_CELL_SIZE = CANVAS_WORLD_WIDTH / CANVAS_GRID_COLS;
export const CANVAS_MAX_TEXT_LENGTH = 40;
export const CANVAS_ERASER_MIN_RADIUS = 16;
export const CANVAS_ERASER_MAX_RADIUS = 96;
export const CANVAS_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#38bdf8',
  '#6366f1',
  '#ec4899',
];

export const canvasRealtimeChannel = (postId: string) => `canvas_${postId}`;
export const smoothMovementBallsKey = (postId: string) =>
  `smooth-movement:v${SMOOTH_MOVEMENT_STATE_VERSION}:balls:${postId}`;
export const sharedCanvasKey = (postId: string) => `canvas:${postId}`;

export type BallPoint = {
  x: number;
  y: number;
};

export type BallState = {
  playerId: string;
  userId: string;
  username: string;
  color: string;
  from: BallPoint;
  to: BallPoint;
  durationMs: number;
  moveStartedAt: number;
  seq: number;
  updatedAt: number;
};

export type CanvasPixelItem = {
  kind: 'pixel';
  id: string;
  userId: string;
  username: string;
  color: string;
  col: number;
  row: number;
  updatedAt: number;
};

export type CanvasTextItem = {
  kind: 'text';
  id: string;
  userId: string;
  username: string;
  color: string;
  x: number;
  y: number;
  text: string;
  updatedAt: number;
};

export type CanvasItem = CanvasPixelItem | CanvasTextItem;

// Shape of messages broadcast over the per-post realtime channel.
export type RealtimeCursorMessage = {
  type: 'cursor';
  userId: string;
  username: string;
  x: number;
  y: number;
  sentAt: number;
};

export type RealtimeBallMoveMessage = {
  type: 'ballMove';
  playerId: string;
  username: string;
  color: string;
  from: BallPoint;
  to: BallPoint;
  durationMs: number;
  seq: number;
  sentAt: number;
};

export const ballMovementDuration = (from: BallPoint, to: BallPoint) =>
  Math.round(
    Math.min(
      BALL_MOVE_MAX_DURATION_MS,
      Math.max(
        BALL_MOVE_MIN_DURATION_MS,
        Math.hypot(to.x - from.x, to.y - from.y) * 2.2
      )
    )
  );

const sineEaseInOut = (value: number) =>
  (1 - Math.cos(Math.PI * value)) / 2;

const pointBetween = (
  from: BallPoint,
  to: BallPoint,
  progress: number
): BallPoint => ({
  x: Math.round(from.x + (to.x - from.x) * progress),
  y: Math.round(from.y + (to.y - from.y) * progress),
});

export const ballMoveMessageFromState = (
  ball: BallState,
  now: number
): RealtimeBallMoveMessage => {
  const elapsedMs = Math.max(0, now - ball.moveStartedAt);
  const durationMs = Math.max(0, ball.durationMs - elapsedMs);
  const progress =
    ball.durationMs === 0 ? 1 : Math.min(1, elapsedMs / ball.durationMs);
  const from =
    durationMs === 0
      ? ball.to
      : pointBetween(ball.from, ball.to, sineEaseInOut(progress));

  return {
    type: 'ballMove',
    playerId: ball.playerId,
    username: ball.username,
    color: ball.color,
    from,
    to: ball.to,
    durationMs,
    seq: ball.seq,
    sentAt: now,
  };
};

export type RealtimeCanvasPutMessage = {
  type: 'canvasPut';
  item: CanvasItem;
  sentAt: number;
};

export type RealtimeCanvasEraseMessage = {
  type: 'canvasErase';
  ids: string[];
  sentAt: number;
};

export type RealtimeCanvasMessage =
  | RealtimeCanvasPutMessage
  | RealtimeCanvasEraseMessage;

export type RealtimeMessage =
  | RealtimeCursorMessage
  | RealtimeBallMoveMessage;
