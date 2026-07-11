export const PONG_WORLD_WIDTH = 960;
export const PONG_WORLD_HEIGHT = 540;
export const PONG_PADDLE_WIDTH = 18;
export const PONG_PADDLE_HEIGHT = 112;
export const PONG_PADDLE_MARGIN = 36;
export const PONG_PADDLE_SPEED = 520;
export const PONG_BALL_RADIUS = 10;
export const PONG_BALL_INITIAL_SPEED = 380;
export const PONG_BALL_MAX_SPEED = 720;
export const PONG_BALL_SPEED_MULTIPLIER = 1.05;
export const PONG_BALL_MAX_BOUNCE_ANGLE = Math.PI / 3;
export const PONG_FIXED_STEP_MS = 10;
export const PONG_WIN_SCORE = 7;
export const PONG_MATCH_COUNTDOWN_MS = 3_000;
export const PONG_POINT_COUNTDOWN_MS = 1_200;
export const PONG_RECONNECT_COUNTDOWN_MS = 3_000;
export const PONG_INPUT_LEASE_MS = 1_000;
export const PONG_STALE_MS = 3_000;
export const PONG_RECONNECT_WINDOW_MS = 15_000;
export const PONG_ROOM_TTL_SECONDS = 24 * 60 * 60;
export const PONG_GAME_STATE_VERSION = 1;

export type PongSide = 'left' | 'right';
export const PONG_SIDES: readonly PongSide[] = ['left', 'right'];
export type PongAxis = -1 | 0 | 1;
export type PongPhase =
  | 'lobby'
  | 'countdown'
  | 'playing'
  | 'paused'
  | 'finished';
export type PongCountdownKind = 'match' | 'point' | 'resume';
export type PongFinishReason = 'score' | 'forfeit' | null;

export type PongPlayerState = {
  playerId: string;
  username: string;
  side: PongSide;
  score: number;
  axis: PongAxis;
  inputSeq: number;
  lastSeenAt: number;
  rematchReady: boolean;
};

export type PongPaddleState = {
  y: number;
};

export type PongBallState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type PongCountdownState = {
  kind: PongCountdownKind;
  endsAt: number;
  launchVx: number;
  launchVy: number;
};

export type PongVelocity = {
  vx: number;
  vy: number;
};

export type PongGameState = {
  schemaVersion: typeof PONG_GAME_STATE_VERSION;
  version: number;
  matchId: string;
  phase: PongPhase;
  players: Record<PongSide, PongPlayerState | null>;
  paddles: Record<PongSide, PongPaddleState>;
  ball: PongBallState;
  simulatedAt: number;
  stepRemainderMs: number;
  countdown: PongCountdownState | null;
  pausedAt: number | null;
  reconnectDeadlineAt: number | null;
  pausedVelocity: PongVelocity | null;
  winnerPlayerId: string | null;
  finishReason: PongFinishReason;
  nextServeSide: PongSide;
  serveVerticalSign: -1 | 1;
};

export type PongSnapshot = {
  state: PongGameState;
  selfPlayerId: string | null;
  serverNow: number;
};

export type PongJoinResult = PongSnapshot & {
  joined: boolean;
};

export type PongSyncRejectionReason =
  | 'not-player'
  | 'stale-match'
  | 'stale-input';

export type PongSyncAccepted = PongSnapshot & {
  accepted: true;
};

export type PongSyncRejected = PongSnapshot & {
  accepted: false;
  reason: PongSyncRejectionReason;
};

export type PongSyncResult = PongSyncAccepted | PongSyncRejected;

export type PongLeaveResult = PongSnapshot & {
  left: boolean;
};

export type PongRematchResult = PongSnapshot & {
  accepted: boolean;
};

export type RealtimePongStateMessage = {
  type: 'pongState';
  state: PongGameState;
  sentAt: number;
};

const centeredPaddles = (): Record<PongSide, PongPaddleState> => ({
  left: { y: PONG_WORLD_HEIGHT / 2 },
  right: { y: PONG_WORLD_HEIGHT / 2 },
});

const centeredBall = (): PongBallState => ({
  x: PONG_WORLD_WIDTH / 2,
  y: PONG_WORLD_HEIGHT / 2,
  vx: 0,
  vy: 0,
});

const serveSeed = (matchId: string): number => {
  let seed = 2_166_136_261;
  for (const character of matchId) {
    seed = Math.imul(seed ^ character.charCodeAt(0), 16_777_619) >>> 0;
  }
  return seed;
};

const initialServe = (
  matchId: string
): { side: PongSide; verticalSign: -1 | 1 } => {
  const seed = serveSeed(matchId);
  return {
    side: seed % 2 === 0 ? 'left' : 'right',
    verticalSign: (seed >>> 1) % 2 === 0 ? -1 : 1,
  };
};

export const createPongGameState = (
  matchId: string,
  now: number
): PongGameState => ({
  schemaVersion: PONG_GAME_STATE_VERSION,
  version: 0,
  matchId,
  phase: 'lobby',
  players: { left: null, right: null },
  paddles: centeredPaddles(),
  ball: centeredBall(),
  simulatedAt: now,
  stepRemainderMs: 0,
  countdown: null,
  pausedAt: null,
  reconnectDeadlineAt: null,
  pausedVelocity: null,
  winnerPlayerId: null,
  finishReason: null,
  nextServeSide: initialServe(matchId).side,
  serveVerticalSign: initialServe(matchId).verticalSign,
});

const clonePlayer = (player: PongPlayerState | null): PongPlayerState | null =>
  player ? { ...player } : null;

export const clonePongGameState = (state: PongGameState): PongGameState => ({
  ...state,
  players: {
    left: clonePlayer(state.players.left),
    right: clonePlayer(state.players.right),
  },
  paddles: {
    left: { ...state.paddles.left },
    right: { ...state.paddles.right },
  },
  ball: { ...state.ball },
  countdown: state.countdown ? { ...state.countdown } : null,
  pausedVelocity: state.pausedVelocity ? { ...state.pausedVelocity } : null,
});

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const playerCount = (state: PongGameState): number =>
  Number(Boolean(state.players.left)) + Number(Boolean(state.players.right));

const nextMatchId = (state: PongGameState): string =>
  `${state.matchId}.${state.version + 1}`;

const serveVelocity = (side: PongSide, verticalSign: -1 | 1): PongVelocity => {
  const angle = Math.PI / 8;
  const horizontalSign = side === 'left' ? -1 : 1;
  return {
    vx: horizontalSign * PONG_BALL_INITIAL_SPEED * Math.cos(angle),
    vy: verticalSign * PONG_BALL_INITIAL_SPEED * Math.sin(angle),
  };
};

const resetPlayersForMatch = (
  players: Record<PongSide, PongPlayerState | null>,
  now: number
): Record<PongSide, PongPlayerState | null> => ({
  left: players.left
    ? {
        ...players.left,
        score: 0,
        axis: 0,
        inputSeq: 0,
        lastSeenAt: now,
        rematchReady: false,
      }
    : null,
  right: players.right
    ? {
        ...players.right,
        score: 0,
        axis: 0,
        inputSeq: 0,
        lastSeenAt: now,
        rematchReady: false,
      }
    : null,
});

const startPongMatch = (state: PongGameState, now: number): PongGameState => {
  if (!state.players.left || !state.players.right) return state;
  const next = clonePongGameState(state);
  const matchId = nextMatchId(state);
  const firstServe = initialServe(matchId);
  const velocity = serveVelocity(firstServe.side, firstServe.verticalSign);
  next.matchId = matchId;
  next.phase = 'countdown';
  next.players = resetPlayersForMatch(next.players, now);
  next.paddles = centeredPaddles();
  next.ball = centeredBall();
  next.simulatedAt = now;
  next.stepRemainderMs = 0;
  next.countdown = {
    kind: 'match',
    endsAt: now + PONG_MATCH_COUNTDOWN_MS,
    launchVx: velocity.vx,
    launchVy: velocity.vy,
  };
  next.pausedAt = null;
  next.reconnectDeadlineAt = null;
  next.pausedVelocity = null;
  next.winnerPlayerId = null;
  next.finishReason = null;
  next.nextServeSide = firstServe.side === 'left' ? 'right' : 'left';
  next.serveVerticalSign = firstServe.verticalSign === 1 ? -1 : 1;
  return next;
};

export const pongPlayerSide = (
  state: PongGameState,
  playerId: string | null
): PongSide | null => {
  if (!playerId) return null;
  if (state.players.left?.playerId === playerId) return 'left';
  if (state.players.right?.playerId === playerId) return 'right';
  return null;
};

const isFresh = (player: PongPlayerState | null, now: number): boolean =>
  Boolean(player && now - player.lastSeenAt < PONG_STALE_MS);

const withResumedCountdown = (
  state: PongGameState,
  now: number
): PongGameState => {
  if (
    state.phase !== 'paused' ||
    !state.players.left ||
    !state.players.right ||
    !isFresh(state.players.left, now) ||
    !isFresh(state.players.right, now) ||
    !state.pausedVelocity
  ) {
    return state;
  }

  const next = clonePongGameState(state);
  const left = next.players.left;
  const right = next.players.right;
  if (!left || !right) return state;
  next.phase = 'countdown';
  next.players.left = { ...left, axis: 0 };
  next.players.right = { ...right, axis: 0 };
  next.countdown = {
    kind: 'resume',
    endsAt: now + PONG_RECONNECT_COUNTDOWN_MS,
    launchVx: state.pausedVelocity.vx,
    launchVy: state.pausedVelocity.vy,
  };
  next.pausedAt = null;
  next.reconnectDeadlineAt = null;
  next.pausedVelocity = null;
  next.simulatedAt = now;
  next.stepRemainderMs = 0;
  return next;
};

export const joinPongPlayer = (
  state: PongGameState,
  playerId: string,
  username: string,
  now: number
): PongGameState => {
  const existingSide = pongPlayerSide(state, playerId);
  if (existingSide) {
    const next = clonePongGameState(state);
    const existing = next.players[existingSide];
    if (!existing) return state;
    next.players[existingSide] = {
      ...existing,
      username,
      lastSeenAt: now,
    };
    return withResumedCountdown(next, now);
  }

  const side: PongSide | null = !state.players.left
    ? 'left'
    : !state.players.right
      ? 'right'
      : null;
  if (!side) return state;

  const next = clonePongGameState(state);
  next.players[side] = {
    playerId,
    username,
    side,
    score: 0,
    axis: 0,
    inputSeq: 0,
    lastSeenAt: now,
    rematchReady: false,
  };
  next.winnerPlayerId = null;
  next.finishReason = null;
  if (playerCount(next) === 2) return startPongMatch(next, now);

  next.phase = 'lobby';
  next.ball = centeredBall();
  next.countdown = null;
  next.pausedAt = null;
  next.reconnectDeadlineAt = null;
  next.pausedVelocity = null;
  next.simulatedAt = now;
  next.stepRemainderMs = 0;
  return next;
};

export const setPongPlayerInput = (
  state: PongGameState,
  playerId: string,
  inputSeq: number,
  axis: PongAxis,
  now: number
): PongGameState => {
  const side = pongPlayerSide(state, playerId);
  if (!side) return state;
  const current = state.players[side];
  if (!current) return state;

  const next = clonePongGameState(state);
  const player = next.players[side];
  if (!player) return state;
  next.players[side] = {
    ...player,
    axis: inputSeq > current.inputSeq ? axis : current.axis,
    inputSeq: Math.max(inputSeq, current.inputSeq),
    lastSeenAt: now,
  };
  return withResumedCountdown(next, now);
};

const finishByForfeit = (
  state: PongGameState,
  winner: PongPlayerState | null,
  missingSide: PongSide | null,
  now: number
): PongGameState => {
  const next = clonePongGameState(state);
  if (missingSide) next.players[missingSide] = null;
  next.phase = winner ? 'finished' : 'lobby';
  next.ball = centeredBall();
  next.countdown = null;
  next.pausedAt = null;
  next.reconnectDeadlineAt = null;
  next.pausedVelocity = null;
  next.winnerPlayerId = winner?.playerId ?? null;
  next.finishReason = winner ? 'forfeit' : null;
  next.simulatedAt = now;
  next.stepRemainderMs = 0;
  return next;
};

export const leavePongPlayer = (
  state: PongGameState,
  playerId: string,
  now: number
): PongGameState => {
  const side = pongPlayerSide(state, playerId);
  if (!side) return state;
  const otherSide: PongSide = side === 'left' ? 'right' : 'left';
  const other = state.players[otherSide];

  if (
    other &&
    (state.phase === 'playing' ||
      state.phase === 'countdown' ||
      state.phase === 'paused')
  ) {
    return finishByForfeit(state, other, side, now);
  }

  const next = clonePongGameState(state);
  next.players[side] = null;
  if (playerCount(next) === 0) {
    return finishByForfeit(next, null, null, now);
  }
  next.phase = state.phase === 'finished' ? 'finished' : 'lobby';
  next.ball = centeredBall();
  next.countdown = null;
  next.pausedAt = null;
  next.reconnectDeadlineAt = null;
  next.pausedVelocity = null;
  next.simulatedAt = now;
  next.stepRemainderMs = 0;
  if (next.winnerPlayerId === playerId) next.winnerPlayerId = null;
  return next;
};

export const requestPongRematch = (
  state: PongGameState,
  playerId: string,
  now: number
): PongGameState => {
  if (state.phase !== 'finished') return state;
  const side = pongPlayerSide(state, playerId);
  if (!side || !state.players.left || !state.players.right) return state;
  const next = clonePongGameState(state);
  const player = next.players[side];
  if (!player) return state;
  next.players[side] = {
    ...player,
    lastSeenAt: now,
    rematchReady: true,
  };
  if (next.players.left?.rematchReady && next.players.right?.rematchReady) {
    return startPongMatch(next, now);
  }
  return next;
};

const pauseForMissingPlayer = (
  state: PongGameState,
  pauseAt: number
): PongGameState => {
  const next = clonePongGameState(state);
  const velocity = state.countdown
    ? {
        vx: state.countdown.launchVx,
        vy: state.countdown.launchVy,
      }
    : { vx: state.ball.vx, vy: state.ball.vy };
  next.phase = 'paused';
  next.ball.vx = 0;
  next.ball.vy = 0;
  next.countdown = null;
  next.pausedAt = pauseAt;
  next.reconnectDeadlineAt = pauseAt + PONG_RECONNECT_WINDOW_MS;
  next.pausedVelocity = velocity;
  next.simulatedAt = pauseAt;
  next.stepRemainderMs = 0;
  next.players.left = next.players.left
    ? { ...next.players.left, axis: 0 }
    : null;
  next.players.right = next.players.right
    ? { ...next.players.right, axis: 0 }
    : null;
  return next;
};

const handlePausedDeadline = (
  state: PongGameState,
  now: number
): PongGameState => {
  if (
    state.phase !== 'paused' ||
    state.reconnectDeadlineAt === null ||
    now < state.reconnectDeadlineAt
  ) {
    return state;
  }

  const leftFresh = isFresh(state.players.left, now);
  const rightFresh = isFresh(state.players.right, now);
  if (leftFresh && !rightFresh) {
    return finishByForfeit(state, state.players.left, 'right', now);
  }
  if (rightFresh && !leftFresh) {
    return finishByForfeit(state, state.players.right, 'left', now);
  }
  if (!leftFresh && !rightFresh) {
    const empty = clonePongGameState(state);
    empty.players = { left: null, right: null };
    return finishByForfeit(empty, null, null, now);
  }
  return withResumedCountdown(state, now);
};

const evictInactiveSeats = (
  state: PongGameState,
  now: number
): PongGameState => {
  const evictionAge = PONG_STALE_MS + PONG_RECONNECT_WINDOW_MS;
  const evictLeft = Boolean(
    state.players.left && now - state.players.left.lastSeenAt >= evictionAge
  );
  const evictRight = Boolean(
    state.players.right && now - state.players.right.lastSeenAt >= evictionAge
  );
  if (!evictLeft && !evictRight) return state;

  const next = clonePongGameState(state);
  if (evictLeft) next.players.left = null;
  if (evictRight) next.players.right = null;
  if (!next.players.left && !next.players.right) {
    return finishByForfeit(next, null, null, now);
  }
  if (next.winnerPlayerId && !pongPlayerSide(next, next.winnerPlayerId)) {
    next.winnerPlayerId = null;
  }
  return next;
};

const movePaddles = (state: PongGameState, stepAt: number): void => {
  const minimumY = PONG_PADDLE_HEIGHT / 2;
  const maximumY = PONG_WORLD_HEIGHT - PONG_PADDLE_HEIGHT / 2;
  const distance = PONG_PADDLE_SPEED * (PONG_FIXED_STEP_MS / 1_000);
  for (const side of PONG_SIDES) {
    const player = state.players[side];
    const axis: PongAxis =
      player && stepAt - player.lastSeenAt <= PONG_INPUT_LEASE_MS
        ? player.axis
        : 0;
    state.paddles[side].y = clamp(
      state.paddles[side].y + axis * distance,
      minimumY,
      maximumY
    );
  }
};

const reflectVerticalWalls = (ball: PongBallState): void => {
  if (ball.y - PONG_BALL_RADIUS < 0 && ball.vy < 0) {
    ball.y = PONG_BALL_RADIUS + (PONG_BALL_RADIUS - ball.y);
    ball.vy = Math.abs(ball.vy);
  } else if (ball.y + PONG_BALL_RADIUS > PONG_WORLD_HEIGHT && ball.vy > 0) {
    const bottom = PONG_WORLD_HEIGHT - PONG_BALL_RADIUS;
    ball.y = bottom - (ball.y - bottom);
    ball.vy = -Math.abs(ball.vy);
  }
};

const paddleCenterX = (side: PongSide): number =>
  side === 'left'
    ? PONG_PADDLE_MARGIN + PONG_PADDLE_WIDTH / 2
    : PONG_WORLD_WIDTH - PONG_PADDLE_MARGIN - PONG_PADDLE_WIDTH / 2;

const paddleCollisionPlaneX = (side: PongSide): number =>
  side === 'left'
    ? paddleCenterX(side) + PONG_PADDLE_WIDTH / 2 + PONG_BALL_RADIUS
    : paddleCenterX(side) - PONG_PADDLE_WIDTH / 2 - PONG_BALL_RADIUS;

const applyPaddleBounce = (
  ball: PongBallState,
  side: PongSide,
  paddleY: number,
  oldX: number,
  oldY: number
): void => {
  const planeX = paddleCollisionPlaneX(side);
  const movingToward = side === 'left' ? ball.vx < 0 : ball.vx > 0;
  const crossed =
    side === 'left'
      ? oldX >= planeX && ball.x <= planeX
      : oldX <= planeX && ball.x >= planeX;
  if (!movingToward || !crossed) return;

  const travelX = ball.x - oldX;
  if (travelX === 0) return;
  const ratio = clamp((planeX - oldX) / travelX, 0, 1);
  const hitY = oldY + (ball.y - oldY) * ratio;
  if (Math.abs(hitY - paddleY) > PONG_PADDLE_HEIGHT / 2 + PONG_BALL_RADIUS) {
    return;
  }

  const remainingRatio = 1 - ratio;
  const currentSpeed = Math.hypot(ball.vx, ball.vy);
  const speed = Math.min(
    PONG_BALL_MAX_SPEED,
    Math.max(PONG_BALL_INITIAL_SPEED, currentSpeed) * PONG_BALL_SPEED_MULTIPLIER
  );
  const impact = clamp((hitY - paddleY) / (PONG_PADDLE_HEIGHT / 2), -1, 1);
  const angle = impact * PONG_BALL_MAX_BOUNCE_ANGLE;
  const horizontalSign = side === 'left' ? 1 : -1;
  ball.vx = horizontalSign * speed * Math.cos(angle);
  ball.vy = speed * Math.sin(angle);
  ball.x = planeX + ball.vx * (PONG_FIXED_STEP_MS / 1_000) * remainingRatio;
  ball.y = hitY + ball.vy * (PONG_FIXED_STEP_MS / 1_000) * remainingRatio;
  reflectVerticalWalls(ball);
};

const finishScoredMatch = (
  state: PongGameState,
  winner: PongPlayerState,
  stepAt: number
): void => {
  state.phase = 'finished';
  state.ball = centeredBall();
  state.countdown = null;
  state.pausedAt = null;
  state.reconnectDeadlineAt = null;
  state.pausedVelocity = null;
  state.winnerPlayerId = winner.playerId;
  state.finishReason = 'score';
  state.simulatedAt = stepAt;
  state.stepRemainderMs = 0;
  state.players.left = state.players.left
    ? { ...state.players.left, axis: 0, rematchReady: false }
    : null;
  state.players.right = state.players.right
    ? { ...state.players.right, axis: 0, rematchReady: false }
    : null;
};

const scorePoint = (
  state: PongGameState,
  scoringSide: PongSide,
  stepAt: number
): void => {
  const player = state.players[scoringSide];
  if (!player) return;
  const scoredPlayer = { ...player, score: player.score + 1 };
  state.players[scoringSide] = scoredPlayer;
  if (scoredPlayer.score >= PONG_WIN_SCORE) {
    finishScoredMatch(state, scoredPlayer, stepAt);
    return;
  }

  const velocity = serveVelocity(state.nextServeSide, state.serveVerticalSign);
  state.phase = 'countdown';
  state.ball = centeredBall();
  state.countdown = {
    kind: 'point',
    endsAt: stepAt + PONG_POINT_COUNTDOWN_MS,
    launchVx: velocity.vx,
    launchVy: velocity.vy,
  };
  state.nextServeSide = state.nextServeSide === 'left' ? 'right' : 'left';
  state.serveVerticalSign = state.serveVerticalSign === 1 ? -1 : 1;
  state.stepRemainderMs = 0;
};

const stepPlayingState = (state: PongGameState, stepAt: number): void => {
  movePaddles(state, stepAt);
  const oldX = state.ball.x;
  const oldY = state.ball.y;
  const seconds = PONG_FIXED_STEP_MS / 1_000;
  state.ball.x += state.ball.vx * seconds;
  state.ball.y += state.ball.vy * seconds;
  reflectVerticalWalls(state.ball);

  if (state.ball.vx < 0) {
    applyPaddleBounce(state.ball, 'left', state.paddles.left.y, oldX, oldY);
  } else if (state.ball.vx > 0) {
    applyPaddleBounce(state.ball, 'right', state.paddles.right.y, oldX, oldY);
  }

  if (state.ball.x + PONG_BALL_RADIUS < 0) {
    scorePoint(state, 'right', stepAt);
  } else if (state.ball.x - PONG_BALL_RADIUS > PONG_WORLD_WIDTH) {
    scorePoint(state, 'left', stepAt);
  }
};

const activeStaleAt = (state: PongGameState): number | null => {
  if (!state.players.left || !state.players.right) return state.simulatedAt;
  return Math.min(
    state.players.left.lastSeenAt + PONG_STALE_MS,
    state.players.right.lastSeenAt + PONG_STALE_MS
  );
};

const advanceActiveState = (
  state: PongGameState,
  targetAt: number
): PongGameState => {
  const next = clonePongGameState(state);

  while (
    (next.phase === 'playing' || next.phase === 'countdown') &&
    next.simulatedAt < targetAt
  ) {
    if (next.phase === 'countdown') {
      const countdown = next.countdown;
      if (!countdown) break;
      if (targetAt < countdown.endsAt) {
        next.stepRemainderMs = 0;
        break;
      }
      next.simulatedAt = Math.max(next.simulatedAt, countdown.endsAt);
      next.stepRemainderMs = 0;
      next.phase = 'playing';
      next.ball.vx = countdown.launchVx;
      next.ball.vy = countdown.launchVy;
      next.countdown = null;
      continue;
    }

    const stepAt = next.simulatedAt + PONG_FIXED_STEP_MS;
    if (stepAt > targetAt) {
      next.stepRemainderMs = targetAt - next.simulatedAt;
      break;
    }
    stepPlayingState(next, stepAt);
    next.simulatedAt = stepAt;
    next.stepRemainderMs = Math.max(0, targetAt - stepAt);
  }

  return next;
};

export const advancePongGame = (
  state: PongGameState,
  now: number
): PongGameState => {
  if (now <= state.simulatedAt) return state;
  if (state.phase === 'paused') return handlePausedDeadline(state, now);
  if (state.phase === 'lobby' || state.phase === 'finished') {
    return evictInactiveSeats(state, now);
  }
  if (state.phase !== 'playing' && state.phase !== 'countdown') return state;

  const staleAt = activeStaleAt(state);
  const targetAt = staleAt === null ? now : Math.min(now, staleAt);
  const advanced = advanceActiveState(state, targetAt);
  if (
    staleAt !== null &&
    now >= staleAt &&
    (advanced.phase === 'playing' || advanced.phase === 'countdown')
  ) {
    return pauseForMissingPlayer(advanced, staleAt);
  }
  return advanced;
};

export const pongGameKey = (postId: string): string =>
  `pong:v${PONG_GAME_STATE_VERSION}:${postId}`;
