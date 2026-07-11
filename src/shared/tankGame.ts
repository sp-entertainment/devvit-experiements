export const TANK_WORLD_WIDTH = 1024;
export const TANK_WORLD_HEIGHT = 640;
export const TANK_WORLD_MARGIN = 48;
export const TANK_RADIUS = 26;
export const TANK_PROJECTILE_RADIUS = 7;
export const TANK_STARTING_HEALTH = 3;
export const TANK_ROTATE_DURATION_MS = 200;
export const TANK_MOVE_SPEED = 360;
export const TANK_PROJECTILE_SPEED = 720;
export const TANK_MIN_TRAVEL_DURATION_MS = 180;
export const TANK_END_TURN_DURATION_MS = 800;
export const TANK_SNAPSHOT_INTERVAL_MS = 5_000;
// Realtime is only a fast path. Keep enough authoritative versions for a
// reconnecting client to replay a short gap before it falls back to a snapshot.
export const TANK_UPDATE_LOG_LIMIT = 100;
export const TANK_GAME_STATE_VERSION = 1;

export const TANK_COLORS = ['#38bdf8', '#facc15'];

export type TankPoint = {
  x: number;
  y: number;
};

export type TankActionKind = 'move' | 'fire';

export type TankGamePhase = 'lobby' | 'playing' | 'finished';

export type TankPlayerState = {
  playerId: string;
  username: string;
  color: string;
  position: TankPoint;
  facing: number;
  health: number;
  joinedAt: number;
};

export type TankResolvedAction = {
  actionId: string;
  kind: TankActionKind;
  actorId: string;
  from: TankPoint;
  target: TankPoint;
  end: TankPoint;
  fromFacing: number;
  facing: number;
  startedAt: number;
  rotateDurationMs: number;
  travelDurationMs: number;
  hitPlayerId: string | null;
  hitHealth: number | null;
};

export type TankGameState = {
  schemaVersion: typeof TANK_GAME_STATE_VERSION;
  version: number;
  phase: TankGamePhase;
  players: TankPlayerState[];
  turnOrder: string[];
  activePlayerId: string | null;
  winnerPlayerId: string | null;
  turnReadyAt: number;
  lastAction: TankResolvedAction | null;
};

export type TankActionRejectionReason =
  | 'not-playing'
  | 'not-player'
  | 'not-your-turn'
  | 'action-resolving'
  | 'invalid-target'
  | 'path-blocked';

export type TankActionAccepted = {
  accepted: true;
  state: TankGameState;
  resolvedAction: TankResolvedAction;
  serverNow: number;
};

export type TankActionRejected = {
  accepted: false;
  reason: TankActionRejectionReason;
  state: TankGameState;
  serverNow: number;
};

export type TankActionResult = TankActionAccepted | TankActionRejected;

export type TankSnapshot = {
  state: TankGameState;
  selfPlayerId: string | null;
  serverNow: number;
};

export type TankUpdatesSince = {
  currentVersion: number;
  updates: TankGameState[];
};

export type TankJoinResult = TankSnapshot & {
  joined: boolean;
};

export type TankRematchResult = TankSnapshot & {
  accepted: boolean;
};

export type RealtimeTankGameMessage = {
  type: 'tankGameState';
  state: TankGameState;
  sentAt: number;
};

export const tankGameKey = (postId: string) =>
  `tank-game:v${TANK_GAME_STATE_VERSION}:${postId}`;

export const tankGameUpdatesKey = (postId: string) =>
  `${tankGameKey(postId)}:updates`;
