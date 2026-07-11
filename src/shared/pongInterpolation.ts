import {
  PONG_FIXED_STEP_MS,
  advancePongGame,
  type PongGameState,
  type PongSide,
} from './pong.js';

export type PongRenderPositions = {
  leftPaddleY: number;
  rightPaddleY: number;
  ballX: number;
  ballY: number;
};

export type PongRenderFrame = {
  state: PongGameState;
  positions: PongRenderPositions;
};

export const getPongRenderPositions = (
  state: PongGameState
): PongRenderPositions => ({
  leftPaddleY: state.paddles.left.y,
  rightPaddleY: state.paddles.right.y,
  ballX: state.ball.x,
  ballY: state.ball.y,
});

export const clampInterpolationAlpha = (alpha: number): number => {
  if (Number.isNaN(alpha)) return 0;
  return Math.min(1, Math.max(0, alpha));
};

export const dampValue = (
  current: number,
  target: number,
  alpha: number
): number => current + (target - current) * clampInterpolationAlpha(alpha);

export const interpolatePongRenderPositions = (
  from: PongRenderPositions,
  to: PongRenderPositions,
  alpha: number
): PongRenderPositions => ({
  leftPaddleY: dampValue(from.leftPaddleY, to.leftPaddleY, alpha),
  rightPaddleY: dampValue(from.rightPaddleY, to.rightPaddleY, alpha),
  ballX: dampValue(from.ballX, to.ballX, alpha),
  ballY: dampValue(from.ballY, to.ballY, alpha),
});

export const exponentialDampingAlpha = (
  deltaMs: number,
  timeConstantMs: number
): number => {
  if (deltaMs <= 0 || Number.isNaN(deltaMs)) return 0;
  if (timeConstantMs <= 0 || Number.isNaN(timeConstantMs)) return 1;
  return clampInterpolationAlpha(1 - Math.exp(-deltaMs / timeConstantMs));
};

const pongScore = (state: PongGameState, side: PongSide): number | null =>
  state.players[side]?.score ?? null;

const canInterpolatePongStates = (
  from: PongGameState,
  to: PongGameState
): boolean =>
  from.matchId === to.matchId &&
  from.phase === to.phase &&
  pongScore(from, 'left') === pongScore(to, 'left') &&
  pongScore(from, 'right') === pongScore(to, 'right');

export const getPongRenderFrame = (
  state: PongGameState,
  targetAt: number
): PongRenderFrame => {
  if (targetAt <= state.simulatedAt) {
    return { state, positions: getPongRenderPositions(state) };
  }

  const advanced = advancePongGame(state, targetAt);
  const positions = getPongRenderPositions(advanced);
  const alpha = clampInterpolationAlpha(
    advanced.stepRemainderMs / PONG_FIXED_STEP_MS
  );
  if (alpha === 0) return { state: advanced, positions };

  const nextStep = advancePongGame(
    advanced,
    advanced.simulatedAt + PONG_FIXED_STEP_MS
  );
  if (!canInterpolatePongStates(advanced, nextStep)) {
    return { state: advanced, positions };
  }

  return {
    state: advanced,
    positions: interpolatePongRenderPositions(
      positions,
      getPongRenderPositions(nextStep),
      alpha
    ),
  };
};
