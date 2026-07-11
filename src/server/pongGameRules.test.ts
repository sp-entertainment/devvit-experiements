import assert from 'node:assert/strict';
import test from 'node:test';
import type { PongGameState, PongSide } from '../shared/pong.js';
import {
  PONG_BALL_INITIAL_SPEED,
  PONG_BALL_MAX_BOUNCE_ANGLE,
  PONG_BALL_MAX_SPEED,
  PONG_BALL_RADIUS,
  PONG_BALL_SPEED_MULTIPLIER,
  PONG_FIXED_STEP_MS,
  PONG_MATCH_COUNTDOWN_MS,
  PONG_PADDLE_HEIGHT,
  PONG_PADDLE_MARGIN,
  PONG_PADDLE_WIDTH,
  PONG_POINT_COUNTDOWN_MS,
  PONG_RECONNECT_COUNTDOWN_MS,
  PONG_RECONNECT_WINDOW_MS,
  PONG_STALE_MS,
  PONG_WIN_SCORE,
  PONG_WORLD_HEIGHT,
  PONG_WORLD_WIDTH,
  advancePongGame,
  clonePongGameState,
  createPongGameState,
  joinPongPlayer,
  leavePongPlayer,
  pongPlayerSide,
  requestPongRematch,
  setPongPlayerInput,
} from '../shared/pong.js';

const LEFT_PLAYER_ID = 'left-player';
const RIGHT_PLAYER_ID = 'right-player';

const closeTo = (
  actual: number,
  expected: number,
  tolerance = 0.000_001
): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
};

const createTwoPlayerGame = (now = 0, matchId = 'pong-test'): PongGameState => {
  let state = createPongGameState(matchId, now);
  state = joinPongPlayer(state, LEFT_PLAYER_ID, 'Left', now);
  return joinPongPlayer(state, RIGHT_PLAYER_ID, 'Right', now);
};

const createPlayingGame = (now = 0): PongGameState => {
  let state = createTwoPlayerGame(now);
  const launchAt = now + PONG_MATCH_COUNTDOWN_MS;
  state = setPongPlayerInput(state, LEFT_PLAYER_ID, 1, 0, launchAt - 1);
  state = setPongPlayerInput(state, RIGHT_PLAYER_ID, 1, 0, launchAt - 1);
  return advancePongGame(state, launchAt);
};

const playerFor = (state: PongGameState, side: PongSide) => {
  const player = state.players[side];
  assert.ok(player, `${side} player should exist`);
  return player;
};

const paddleCollisionPlaneX = (side: PongSide): number => {
  const centerX =
    side === 'left'
      ? PONG_PADDLE_MARGIN + PONG_PADDLE_WIDTH / 2
      : PONG_WORLD_WIDTH - PONG_PADDLE_MARGIN - PONG_PADDLE_WIDTH / 2;
  return side === 'left'
    ? centerX + PONG_PADDLE_WIDTH / 2 + PONG_BALL_RADIUS
    : centerX - PONG_PADDLE_WIDTH / 2 - PONG_BALL_RADIUS;
};

const createPausedGame = (pauseAt = 10_000): PongGameState => {
  const state = createPlayingGame();
  state.simulatedAt = pauseAt - PONG_FIXED_STEP_MS;
  state.stepRemainderMs = 0;
  playerFor(state, 'left').lastSeenAt = pauseAt - PONG_FIXED_STEP_MS;
  playerFor(state, 'right').lastSeenAt = pauseAt - PONG_STALE_MS;
  state.ball.vx = 200;
  state.ball.vy = -50;
  return advancePongGame(state, pauseAt);
};

const createFinishedScoreGame = (): PongGameState => {
  const state = createPlayingGame();
  playerFor(state, 'left').score = PONG_WIN_SCORE - 1;
  state.ball.x = PONG_WORLD_WIDTH + PONG_BALL_RADIUS;
  state.ball.y = PONG_WORLD_HEIGHT / 2;
  state.ball.vx = PONG_BALL_INITIAL_SPEED;
  state.ball.vy = 0;
  return advancePongGame(state, state.simulatedAt + PONG_FIXED_STEP_MS);
};

void test('fixed-step simulation is invariant to target-time chunking', () => {
  let state = createPlayingGame();
  state = setPongPlayerInput(state, LEFT_PLAYER_ID, 2, 1, state.simulatedAt);
  state.ball.vx = 123;
  state.ball.vy = 47;

  const startAt = state.simulatedAt;
  const direct = advancePongGame(clonePongGameState(state), startAt + 507);
  let chunked = advancePongGame(clonePongGameState(state), startAt + 103);
  chunked = advancePongGame(chunked, startAt + 271);
  chunked = advancePongGame(chunked, startAt + 507);

  assert.deepEqual(chunked, direct);
  assert.equal(direct.simulatedAt, startAt + 500);
  assert.equal(direct.stepRemainderMs, 7);
});

void test('paddles clamp to the playable top and bottom edges', () => {
  const minimumY = PONG_PADDLE_HEIGHT / 2;
  const maximumY = PONG_WORLD_HEIGHT - PONG_PADDLE_HEIGHT / 2;

  let topState = createPlayingGame();
  topState.paddles.left.y = minimumY + 1;
  topState = setPongPlayerInput(
    topState,
    LEFT_PLAYER_ID,
    2,
    -1,
    topState.simulatedAt
  );
  topState = advancePongGame(
    topState,
    topState.simulatedAt + PONG_FIXED_STEP_MS
  );

  let bottomState = createPlayingGame();
  bottomState.paddles.right.y = maximumY - 1;
  bottomState = setPongPlayerInput(
    bottomState,
    RIGHT_PLAYER_ID,
    2,
    1,
    bottomState.simulatedAt
  );
  bottomState = advancePongGame(
    bottomState,
    bottomState.simulatedAt + PONG_FIXED_STEP_MS
  );

  assert.equal(topState.paddles.left.y, minimumY);
  assert.equal(bottomState.paddles.right.y, maximumY);
});

void test('ball reflects from both horizontal arena walls', () => {
  let topState = createPlayingGame();
  topState.ball.y = PONG_BALL_RADIUS + 1;
  topState.ball.vx = 0;
  topState.ball.vy = -200;
  topState = advancePongGame(
    topState,
    topState.simulatedAt + PONG_FIXED_STEP_MS
  );

  let bottomState = createPlayingGame();
  bottomState.ball.y = PONG_WORLD_HEIGHT - PONG_BALL_RADIUS - 1;
  bottomState.ball.vx = 0;
  bottomState.ball.vy = 200;
  bottomState = advancePongGame(
    bottomState,
    bottomState.simulatedAt + PONG_FIXED_STEP_MS
  );

  assert.equal(topState.ball.y, PONG_BALL_RADIUS + 1);
  assert.equal(topState.ball.vy, 200);
  assert.equal(bottomState.ball.y, PONG_WORLD_HEIGHT - PONG_BALL_RADIUS - 1);
  assert.equal(bottomState.ball.vy, -200);
});

void test('swept paddle collision reflects a fast ball and increases speed', () => {
  const state = createPlayingGame();
  const planeX = paddleCollisionPlaneX('left');
  state.ball.x = planeX + 7;
  state.ball.y = state.paddles.left.y;
  state.ball.vx = -PONG_BALL_MAX_SPEED;
  state.ball.vy = 0;

  const bounced = advancePongGame(
    state,
    state.simulatedAt + PONG_FIXED_STEP_MS
  );

  assert.ok(bounced.ball.vx > 0);
  closeTo(Math.hypot(bounced.ball.vx, bounced.ball.vy), PONG_BALL_MAX_SPEED);
  closeTo(bounced.ball.vy, 0);
  assert.ok(bounced.ball.x > planeX);
});

void test('paddle impact position controls bounce angle and uncapped speed', () => {
  const state = createPlayingGame();
  const planeX = paddleCollisionPlaneX('right');
  const incomingSpeed = 400;
  state.ball.x = planeX - 2;
  state.ball.y = state.paddles.right.y + PONG_PADDLE_HEIGHT / 4;
  state.ball.vx = incomingSpeed;
  state.ball.vy = 0;

  const bounced = advancePongGame(
    state,
    state.simulatedAt + PONG_FIXED_STEP_MS
  );
  const expectedSpeed = incomingSpeed * PONG_BALL_SPEED_MULTIPLIER;
  const expectedAngle = PONG_BALL_MAX_BOUNCE_ANGLE / 2;

  assert.ok(bounced.ball.vx < 0);
  assert.ok(bounced.ball.vy > 0);
  closeTo(Math.hypot(bounced.ball.vx, bounced.ball.vy), expectedSpeed);
  closeTo(
    Math.atan2(Math.abs(bounced.ball.vy), Math.abs(bounced.ball.vx)),
    expectedAngle
  );
});

void test('a point updates score, recenters, and alternates the next serve', () => {
  const state = createPlayingGame();
  const scoringAt = state.simulatedAt + PONG_FIXED_STEP_MS;
  const serveSide = state.nextServeSide;
  const verticalSign = state.serveVerticalSign;
  state.ball.x = -PONG_BALL_RADIUS;
  state.ball.y = PONG_WORLD_HEIGHT / 2;
  state.ball.vx = -PONG_BALL_INITIAL_SPEED;
  state.ball.vy = 0;

  let scored = advancePongGame(state, scoringAt);

  assert.equal(playerFor(scored, 'right').score, 1);
  assert.equal(scored.phase, 'countdown');
  assert.deepEqual(scored.ball, {
    x: PONG_WORLD_WIDTH / 2,
    y: PONG_WORLD_HEIGHT / 2,
    vx: 0,
    vy: 0,
  });
  assert.ok(scored.countdown);
  assert.equal(scored.countdown.kind, 'point');
  assert.equal(scored.countdown.endsAt, scoringAt + PONG_POINT_COUNTDOWN_MS);
  assert.equal(
    Math.sign(scored.countdown.launchVx),
    serveSide === 'left' ? -1 : 1
  );
  assert.equal(Math.sign(scored.countdown.launchVy), verticalSign);
  closeTo(
    Math.hypot(scored.countdown.launchVx, scored.countdown.launchVy),
    PONG_BALL_INITIAL_SPEED
  );
  assert.equal(scored.nextServeSide, serveSide === 'left' ? 'right' : 'left');
  assert.equal(scored.serveVerticalSign, verticalSign === 1 ? -1 : 1);

  const launchAt = scored.countdown.endsAt;
  scored = setPongPlayerInput(scored, LEFT_PLAYER_ID, 2, 0, launchAt - 1);
  scored = setPongPlayerInput(scored, RIGHT_PLAYER_ID, 2, 0, launchAt - 1);
  const launched = advancePongGame(scored, launchAt);

  assert.equal(launched.phase, 'playing');
  assert.equal(launched.countdown, null);
  assert.notEqual(launched.ball.vx, 0);
});

void test('the seventh point finishes the match with the scoring winner', () => {
  let state = createPlayingGame();
  playerFor(state, 'right').score = PONG_WIN_SCORE - 1;
  state = setPongPlayerInput(state, LEFT_PLAYER_ID, 2, 1, state.simulatedAt);
  state = setPongPlayerInput(state, RIGHT_PLAYER_ID, 2, -1, state.simulatedAt);
  state.ball.x = -PONG_BALL_RADIUS;
  state.ball.vx = -PONG_BALL_INITIAL_SPEED;
  state.ball.vy = 0;

  const finished = advancePongGame(
    state,
    state.simulatedAt + PONG_FIXED_STEP_MS
  );

  assert.equal(finished.phase, 'finished');
  assert.equal(playerFor(finished, 'right').score, PONG_WIN_SCORE);
  assert.equal(finished.winnerPlayerId, RIGHT_PLAYER_ID);
  assert.equal(finished.finishReason, 'score');
  assert.equal(playerFor(finished, 'left').axis, 0);
  assert.equal(playerFor(finished, 'right').axis, 0);
  assert.deepEqual(finished.ball, {
    x: PONG_WORLD_WIDTH / 2,
    y: PONG_WORLD_HEIGHT / 2,
    vx: 0,
    vy: 0,
  });
});

void test('stale input refreshes presence without replacing newer controls', () => {
  let state = createPlayingGame();
  state = setPongPlayerInput(state, LEFT_PLAYER_ID, 10, 1, 3_100);
  state = setPongPlayerInput(state, LEFT_PLAYER_ID, 9, -1, 3_200);
  state = setPongPlayerInput(state, LEFT_PLAYER_ID, 10, -1, 3_250);

  const player = playerFor(state, 'left');
  assert.equal(player.axis, 1);
  assert.equal(player.inputSeq, 10);
  assert.equal(player.lastSeenAt, 3_250);

  const spectatorAttempt = setPongPlayerInput(
    state,
    'spectator',
    99,
    -1,
    3_300
  );
  assert.strictEqual(spectatorAttempt, state);
});

void test('a stale active player pauses play and preserves rally velocity', () => {
  const pauseAt = 10_000;
  const paused = createPausedGame(pauseAt);

  assert.equal(paused.phase, 'paused');
  assert.equal(paused.pausedAt, pauseAt);
  assert.equal(paused.reconnectDeadlineAt, pauseAt + PONG_RECONNECT_WINDOW_MS);
  assert.deepEqual(paused.pausedVelocity, { vx: 200, vy: -50 });
  assert.equal(paused.ball.vx, 0);
  assert.equal(paused.ball.vy, 0);
  assert.equal(playerFor(paused, 'left').axis, 0);
  assert.equal(playerFor(paused, 'right').axis, 0);
});

void test('a returning player starts a resume countdown and restores the rally', () => {
  const pauseAt = 10_000;
  let state = createPausedGame(pauseAt);
  state = setPongPlayerInput(state, RIGHT_PLAYER_ID, 2, 0, pauseAt + 1);

  assert.equal(state.phase, 'countdown');
  assert.ok(state.countdown);
  assert.equal(state.countdown.kind, 'resume');
  assert.equal(
    state.countdown.endsAt,
    pauseAt + 1 + PONG_RECONNECT_COUNTDOWN_MS
  );
  assert.deepEqual(
    {
      vx: state.countdown.launchVx,
      vy: state.countdown.launchVy,
    },
    { vx: 200, vy: -50 }
  );
  assert.equal(state.pausedVelocity, null);

  const launchAt = state.countdown.endsAt;
  state = setPongPlayerInput(state, LEFT_PLAYER_ID, 2, 1, launchAt - 1);
  state = setPongPlayerInput(state, RIGHT_PLAYER_ID, 3, -1, launchAt - 1);
  state = advancePongGame(state, launchAt);

  assert.equal(state.phase, 'playing');
  assert.equal(state.ball.vx, 200);
  assert.equal(state.ball.vy, -50);
});

void test('reconnect expiry awards a forfeit and removes the missing seat', () => {
  const pauseAt = 10_000;
  let state = createPausedGame(pauseAt);
  const deadlineAt = pauseAt + PONG_RECONNECT_WINDOW_MS;
  state = setPongPlayerInput(state, LEFT_PLAYER_ID, 2, 0, deadlineAt - 1);
  state = advancePongGame(state, deadlineAt);

  assert.equal(state.phase, 'finished');
  assert.equal(state.finishReason, 'forfeit');
  assert.equal(state.winnerPlayerId, LEFT_PLAYER_ID);
  assert.ok(state.players.left);
  assert.equal(state.players.right, null);
});

void test('reconnect expiry clears a room when both players disappear', () => {
  const pauseAt = 10_000;
  const state = advancePongGame(
    createPausedGame(pauseAt),
    pauseAt + PONG_RECONNECT_WINDOW_MS
  );

  assert.equal(state.phase, 'lobby');
  assert.deepEqual(state.players, { left: null, right: null });
  assert.equal(state.winnerPlayerId, null);
  assert.equal(state.finishReason, null);
});

void test('inactive lobby seats are evicted after stale and reconnect windows', () => {
  let state = createPongGameState('lobby', 0);
  state = joinPongPlayer(state, LEFT_PLAYER_ID, 'Left', 0);

  const beforeEviction = advancePongGame(
    state,
    PONG_STALE_MS + PONG_RECONNECT_WINDOW_MS - 1
  );
  const evicted = advancePongGame(
    beforeEviction,
    PONG_STALE_MS + PONG_RECONNECT_WINDOW_MS
  );

  assert.ok(beforeEviction.players.left);
  assert.equal(evicted.phase, 'lobby');
  assert.deepEqual(evicted.players, { left: null, right: null });
});

void test('players claim seats in order and a full room remains spectator-only', () => {
  const initial = createPongGameState('join-test', 100);
  const first = joinPongPlayer(initial, LEFT_PLAYER_ID, 'Old name', 100);
  const rejoined = joinPongPlayer(first, LEFT_PLAYER_ID, 'Updated name', 150);
  const second = joinPongPlayer(rejoined, RIGHT_PLAYER_ID, 'Right', 200);
  const spectator = joinPongPlayer(second, 'third-player', 'Third', 250);

  assert.equal(pongPlayerSide(first, LEFT_PLAYER_ID), 'left');
  assert.equal(playerFor(rejoined, 'left').username, 'Updated name');
  assert.equal(playerFor(rejoined, 'left').lastSeenAt, 150);
  assert.equal(rejoined.players.right, null);
  assert.equal(pongPlayerSide(second, RIGHT_PLAYER_ID), 'right');
  assert.equal(second.phase, 'countdown');
  assert.ok(second.countdown);
  assert.equal(second.countdown.kind, 'match');
  assert.equal(second.countdown.endsAt, 200 + PONG_MATCH_COUNTDOWN_MS);
  assert.strictEqual(spectator, second);
  assert.equal(pongPlayerSide(second, 'third-player'), null);
});

void test('leaving an active match forfeits and a replacement starts fresh', () => {
  const active = createPlayingGame();
  const forfeited = leavePongPlayer(
    active,
    LEFT_PLAYER_ID,
    active.simulatedAt + 1
  );

  assert.equal(forfeited.phase, 'finished');
  assert.equal(forfeited.finishReason, 'forfeit');
  assert.equal(forfeited.winnerPlayerId, RIGHT_PLAYER_ID);
  assert.equal(forfeited.players.left, null);

  const replacement = joinPongPlayer(
    forfeited,
    'replacement',
    'Replacement',
    active.simulatedAt + 2
  );

  assert.equal(replacement.phase, 'countdown');
  assert.equal(playerFor(replacement, 'left').playerId, 'replacement');
  assert.equal(playerFor(replacement, 'right').score, 0);
  assert.equal(replacement.winnerPlayerId, null);
  assert.equal(replacement.finishReason, null);
});

void test('a scored match restarts only after both players request rematch', () => {
  const finished = createFinishedScoreGame();
  assert.equal(finished.phase, 'finished');

  const spectatorAttempt = requestPongRematch(
    finished,
    'spectator',
    finished.simulatedAt + 1
  );
  assert.strictEqual(spectatorAttempt, finished);

  const leftReady = requestPongRematch(
    finished,
    LEFT_PLAYER_ID,
    finished.simulatedAt + 2
  );
  assert.equal(leftReady.phase, 'finished');
  assert.equal(playerFor(leftReady, 'left').rematchReady, true);
  assert.equal(playerFor(leftReady, 'right').rematchReady, false);

  const restarted = requestPongRematch(
    leftReady,
    RIGHT_PLAYER_ID,
    finished.simulatedAt + 3
  );
  assert.equal(restarted.phase, 'countdown');
  assert.notEqual(restarted.matchId, finished.matchId);
  assert.equal(playerFor(restarted, 'left').score, 0);
  assert.equal(playerFor(restarted, 'right').score, 0);
  assert.equal(playerFor(restarted, 'left').rematchReady, false);
  assert.equal(playerFor(restarted, 'right').rematchReady, false);
  assert.equal(restarted.winnerPlayerId, null);
  assert.equal(restarted.finishReason, null);
});
