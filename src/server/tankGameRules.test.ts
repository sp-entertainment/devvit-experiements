import assert from 'node:assert/strict';
import test from 'node:test';
import type { TankPlayerState, TankPoint } from '../shared/tankGame.js';
import {
  firstProjectileHit,
  movementPathIsBlocked,
  nextLivingPlayerId,
  segmentCircleIntersection,
} from './tankGameRules.js';

const player = (
  playerId: string,
  position: TankPoint,
  health = 3
): TankPlayerState => ({
  playerId,
  username: playerId,
  color: '#38bdf8',
  position,
  facing: 0,
  health,
  joinedAt: 0,
});

void test('segment-circle intersection returns the first tangent point', () => {
  const hit = segmentCircleIntersection(
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 5, y: 2 },
    2
  );

  assert.ok(hit);
  assert.equal(hit.distanceRatio, 0.5);
  assert.deepEqual(hit.point, { x: 5, y: 0 });
});

void test('segment-circle intersection ignores circles beyond the target', () => {
  assert.equal(
    segmentCircleIntersection(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 12, y: 0 },
      1
    ),
    undefined
  );
});

void test('movement rejects any tank intersecting the full swept path', () => {
  const players = [
    player('actor', { x: 100, y: 100 }),
    player('other', { x: 300, y: 100 }),
  ];

  assert.equal(
    movementPathIsBlocked(
      players[0]?.position ?? { x: 0, y: 0 },
      { x: 500, y: 100 },
      players,
      'actor'
    ),
    true
  );
  assert.equal(
    movementPathIsBlocked(
      players[0]?.position ?? { x: 0, y: 0 },
      { x: 500, y: 300 },
      players,
      'actor'
    ),
    false
  );
});

void test('projectiles hit the nearest living tank before their target', () => {
  const players = [
    player('actor', { x: 100, y: 100 }),
    player('near', { x: 300, y: 100 }),
    player('far', { x: 500, y: 100 }),
  ];

  const hit = firstProjectileHit(
    { x: 100, y: 100 },
    { x: 700, y: 100 },
    players,
    'actor'
  );
  assert.equal(hit?.playerId, 'near');
  assert.ok(hit && hit.point.x < 300);
});

void test('projectiles miss eliminated tanks and tanks beyond the target', () => {
  const players = [
    player('actor', { x: 100, y: 100 }),
    player('eliminated', { x: 250, y: 100 }, 0),
    player('beyond', { x: 500, y: 100 }),
  ];

  assert.equal(
    firstProjectileHit(
      { x: 100, y: 100 },
      { x: 400, y: 100 },
      players,
      'actor'
    ),
    undefined
  );
});

void test('turn order skips eliminated players', () => {
  const players = [
    player('one', { x: 0, y: 0 }),
    player('two', { x: 0, y: 0 }, 0),
    player('three', { x: 0, y: 0 }),
  ];

  assert.equal(
    nextLivingPlayerId(['one', 'two', 'three'], players, 'one'),
    'three'
  );
});
