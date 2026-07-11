import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PONG_BALL_RADIUS,
  PONG_MATCH_COUNTDOWN_MS,
  PONG_PADDLE_SPEED,
  PONG_WORLD_WIDTH,
  advancePongGame,
  createPongGameState,
  joinPongPlayer,
  setPongPlayerInput,
  type PongGameState,
} from '../shared/pong.js';
import {
  clampInterpolationAlpha,
  dampValue,
  exponentialDampingAlpha,
  getPongRenderPositions,
  getPongRenderFrame,
  interpolatePongRenderPositions,
  type PongRenderPositions,
} from '../shared/pongInterpolation.js';

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

const from: PongRenderPositions = {
  leftPaddleY: 100,
  rightPaddleY: 200,
  ballX: 300,
  ballY: 400,
};

const to: PongRenderPositions = {
  leftPaddleY: 200,
  rightPaddleY: 400,
  ballX: 600,
  ballY: 800,
};

const createPlayingGame = (): PongGameState => {
  let state = createPongGameState('render-frame-test', 0);
  state = joinPongPlayer(state, 'left-player', 'Left', 0);
  state = joinPongPlayer(state, 'right-player', 'Right', 0);
  state = setPongPlayerInput(
    state,
    'left-player',
    1,
    0,
    PONG_MATCH_COUNTDOWN_MS - 1
  );
  state = setPongPlayerInput(
    state,
    'right-player',
    1,
    0,
    PONG_MATCH_COUNTDOWN_MS - 1
  );
  state = advancePongGame(state, PONG_MATCH_COUNTDOWN_MS);
  return state;
};

void test('render positions are extracted from Pong game state', () => {
  const state = createPongGameState('interpolation-test', 0);
  state.paddles.left.y = 123;
  state.paddles.right.y = 456;
  state.ball.x = 321;
  state.ball.y = 234;

  assert.deepEqual(getPongRenderPositions(state), {
    leftPaddleY: 123,
    rightPaddleY: 456,
    ballX: 321,
    ballY: 234,
  });
});

void test('position interpolation returns both endpoints and the midpoint', () => {
  assert.deepEqual(interpolatePongRenderPositions(from, to, 0), from);
  assert.deepEqual(interpolatePongRenderPositions(from, to, 1), to);
  assert.deepEqual(interpolatePongRenderPositions(from, to, 0.5), {
    leftPaddleY: 150,
    rightPaddleY: 300,
    ballX: 450,
    ballY: 600,
  });
});

void test('interpolation alpha clamps to the inclusive unit interval', () => {
  assert.equal(clampInterpolationAlpha(-10), 0);
  assert.equal(clampInterpolationAlpha(0.25), 0.25);
  assert.equal(clampInterpolationAlpha(10), 1);
  assert.equal(clampInterpolationAlpha(Number.NEGATIVE_INFINITY), 0);
  assert.equal(clampInterpolationAlpha(Number.POSITIVE_INFINITY), 1);
  assert.equal(clampInterpolationAlpha(Number.NaN), 0);
  assert.deepEqual(interpolatePongRenderPositions(from, to, -1), from);
  assert.deepEqual(interpolatePongRenderPositions(from, to, 2), to);
});

void test('zero frame delta leaves damping at its current value', () => {
  const alpha = exponentialDampingAlpha(0, 100);

  assert.equal(alpha, 0);
  assert.equal(dampValue(20, 80, alpha), 20);
});

void test('exponential damping is invariant to frame partitioning', () => {
  const current = -20;
  const target = 100;
  const timeConstantMs = 120;
  const wholeFrame = dampValue(
    current,
    target,
    exponentialDampingAlpha(32, timeConstantMs)
  );
  const halfFrameAlpha = exponentialDampingAlpha(16, timeConstantMs);
  const twoHalfFrames = dampValue(
    dampValue(current, target, halfFrameAlpha),
    target,
    halfFrameAlpha
  );

  closeTo(twoHalfFrames, wholeFrame);
});

void test('exponential damping converges monotonically without overshoot', () => {
  const target = 100;
  const alpha = exponentialDampingAlpha(16, 100);
  let current = 0;

  for (let frame = 0; frame < 60; frame += 1) {
    const next = dampValue(current, target, alpha);
    assert.ok(next > current);
    assert.ok(next < target);
    current = next;
  }

  assert.ok(current > 99.99);
});

void test('render frame interpolates fractional ball and paddle motion', () => {
  let state = createPlayingGame();
  state = setPongPlayerInput(state, 'left-player', 2, 1, state.simulatedAt);
  state.ball.x = 300;
  state.ball.y = 200;
  state.ball.vx = 100;
  state.ball.vy = 200;
  const initialPaddleY = state.paddles.left.y;

  const frame = getPongRenderFrame(state, state.simulatedAt + 5);

  assert.equal(frame.state.stepRemainderMs, 5);
  closeTo(
    frame.positions.leftPaddleY,
    initialPaddleY + PONG_PADDLE_SPEED * 0.005
  );
  closeTo(frame.positions.ballX, 300.5);
  closeTo(frame.positions.ballY, 201);
});

void test('render frame ignores persisted remainder at or before the simulated clock', () => {
  const state = createPlayingGame();
  state.ball.x = 300;
  state.ball.y = 200;
  state.ball.vx = 100;
  state.ball.vy = 200;
  state.stepRemainderMs = 5;

  const atFrame = getPongRenderFrame(state, state.simulatedAt);
  const beforeFrame = getPongRenderFrame(state, state.simulatedAt - 1);

  assert.equal(atFrame.state, state);
  assert.equal(beforeFrame.state, state);
  assert.deepEqual(atFrame.positions, getPongRenderPositions(state));
  assert.deepEqual(beforeFrame.positions, getPongRenderPositions(state));
});

void test('render frame does not interpolate across a scored point', () => {
  const state = createPlayingGame();
  state.ball.x = PONG_WORLD_WIDTH + PONG_BALL_RADIUS + 1;
  state.ball.y = 200;
  state.ball.vx = 100;
  state.ball.vy = 0;

  const frame = getPongRenderFrame(state, state.simulatedAt + 5);

  assert.equal(frame.state.phase, 'playing');
  assert.equal(frame.state.players.left?.score, 0);
  assert.deepEqual(frame.positions, getPongRenderPositions(frame.state));
});
