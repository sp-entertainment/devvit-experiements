export const BALL_WORLD_WIDTH = 1024;
export const BALL_WORLD_HEIGHT = 768;
export const BALL_MARGIN = 36;
export const BALL_STALE_MS = 30_000;
export const BALL_MOVE_MIN_DURATION_MS = 450;
export const BALL_MOVE_MAX_DURATION_MS = 1_400;

export type BallPoint = {
  x: number;
  y: number;
};

export type BallState = {
  clientId: string;
  userId: string;
  username: string;
  color: string;
  x: number;
  y: number;
  seq: number;
  updatedAt: number;
};

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
  clientId: string;
  username: string;
  color: string;
  from: BallPoint;
  to: BallPoint;
  durationMs: number;
  seq: number;
  sentAt: number;
};

export type RealtimeMessage =
  | RealtimeCursorMessage
  | RealtimeBallMoveMessage;
