import {
  TANK_END_TURN_DURATION_MS,
  TANK_MIN_TRAVEL_DURATION_MS,
  TANK_MOVE_SPEED,
  TANK_PROJECTILE_RADIUS,
  TANK_PROJECTILE_SPEED,
  TANK_RADIUS,
  TANK_ROTATE_DURATION_MS,
  type TankActionKind,
  type TankPlayerState,
  type TankPoint,
} from '../shared/tankGame.js';

export type TankIntersection = {
  playerId: string;
  point: TankPoint;
  distanceRatio: number;
};

const intersectionEpsilon = 0.000001;

export const tankDistance = (from: TankPoint, to: TankPoint): number =>
  Math.hypot(to.x - from.x, to.y - from.y);

export const tankFacing = (from: TankPoint, to: TankPoint): number =>
  Math.atan2(to.y - from.y, to.x - from.x);

export const segmentCircleIntersection = (
  from: TankPoint,
  to: TankPoint,
  center: TankPoint,
  radius: number
): { point: TankPoint; distanceRatio: number } | undefined => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= intersectionEpsilon) return undefined;

  const offsetX = from.x - center.x;
  const offsetY = from.y - center.y;
  const coefficientB = 2 * (offsetX * dx + offsetY * dy);
  const coefficientC = offsetX * offsetX + offsetY * offsetY - radius * radius;
  const discriminant =
    coefficientB * coefficientB - 4 * lengthSquared * coefficientC;
  if (discriminant < 0) return undefined;

  const root = Math.sqrt(discriminant);
  const candidates = [
    (-coefficientB - root) / (2 * lengthSquared),
    (-coefficientB + root) / (2 * lengthSquared),
  ]
    .filter(
      (candidate) =>
        candidate > intersectionEpsilon && candidate <= 1 + intersectionEpsilon
    )
    .sort((left, right) => left - right);
  const distanceRatio = candidates[0];
  if (distanceRatio === undefined) return undefined;

  return {
    point: {
      x: from.x + dx * Math.min(1, distanceRatio),
      y: from.y + dy * Math.min(1, distanceRatio),
    },
    distanceRatio,
  };
};

export const firstTankIntersection = (
  from: TankPoint,
  to: TankPoint,
  players: TankPlayerState[],
  actorId: string,
  radius: number
): TankIntersection | undefined => {
  let nearest: TankIntersection | undefined;

  for (const player of players) {
    if (player.playerId === actorId || player.health <= 0) continue;

    const intersection = segmentCircleIntersection(
      from,
      to,
      player.position,
      radius
    );
    if (
      intersection &&
      (!nearest || intersection.distanceRatio < nearest.distanceRatio)
    ) {
      nearest = { playerId: player.playerId, ...intersection };
    }
  }

  return nearest;
};

export const movementPathIsBlocked = (
  from: TankPoint,
  to: TankPoint,
  players: TankPlayerState[],
  actorId: string
): boolean =>
  firstTankIntersection(from, to, players, actorId, TANK_RADIUS * 2) !==
  undefined;

export const firstProjectileHit = (
  from: TankPoint,
  to: TankPoint,
  players: TankPlayerState[],
  actorId: string
): TankIntersection | undefined =>
  firstTankIntersection(
    from,
    to,
    players,
    actorId,
    TANK_RADIUS + TANK_PROJECTILE_RADIUS
  );

export const actionTravelDuration = (
  kind: TankActionKind,
  from: TankPoint,
  to: TankPoint
): number =>
  Math.max(
    TANK_MIN_TRAVEL_DURATION_MS,
    Math.round(
      (tankDistance(from, to) /
        (kind === 'move' ? TANK_MOVE_SPEED : TANK_PROJECTILE_SPEED)) *
        1_000
    )
  );

export const actionTurnReadyAt = (
  startedAt: number,
  travelDurationMs: number
): number =>
  startedAt +
  TANK_ROTATE_DURATION_MS +
  travelDurationMs +
  TANK_END_TURN_DURATION_MS;

export const nextLivingPlayerId = (
  turnOrder: string[],
  players: TankPlayerState[],
  currentPlayerId: string
): string | undefined => {
  const startIndex = turnOrder.indexOf(currentPlayerId);
  if (startIndex < 0) return undefined;

  for (let offset = 1; offset <= turnOrder.length; offset += 1) {
    const playerId = turnOrder[(startIndex + offset) % turnOrder.length];
    const player = players.find((candidate) => candidate.playerId === playerId);
    if (player && player.health > 0) return playerId;
  }

  return undefined;
};
