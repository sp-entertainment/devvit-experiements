import { context, showToast } from '@devvit/web/client';
import * as Phaser from 'phaser';
import {
  PONG_BALL_RADIUS,
  PONG_PADDLE_HEIGHT,
  PONG_PADDLE_MARGIN,
  PONG_PADDLE_WIDTH,
  PONG_SIDES,
  PONG_STALE_MS,
  PONG_WORLD_HEIGHT,
  PONG_WORLD_WIDTH,
  advancePongGame,
  pongPlayerSide,
  setPongPlayerInput,
  type PongAxis,
  type PongGameState,
  type PongPhase,
  type PongSide,
} from '../shared/pong';
import {
  dampValue,
  exponentialDampingAlpha,
  getPongRenderFrame,
  type PongRenderFrame,
  type PongRenderPositions,
} from '../shared/pongInterpolation';
import { traceClientLog } from './clientLogs';
import {
  onPongGameConnectionChange,
  onPongGameMessage,
} from './realtimeChannel';
import { trpc } from './trpc';

const PONG_ACTIVE_SYNC_INTERVAL_MS = 400;
const PONG_IDLE_SYNC_INTERVAL_MS = 1_000;
const PONG_SNAPSHOT_INTERVAL_MS = 2_000;
const PONG_RENDER_STALE_MS = 750;
const PONG_LOCAL_PADDLE_CORRECTION_MS = 50;
const PONG_REMOTE_PADDLE_CORRECTION_MS = 115;
const PONG_BALL_CORRECTION_MS = 72;
const PONG_CORRECTION_EPSILON = 0.1;
const PONG_LOCAL_PADDLE_SNAP_DISTANCE = 56;
const PONG_REMOTE_PADDLE_SNAP_DISTANCE = 112;
const PONG_BALL_SNAP_DISTANCE = 96;
const PONG_CLOCK_OFFSET_SMOOTHING = 0.2;

export type PongPlayerView = {
  side: PongSide;
  username: string;
  score: number;
  isSelf: boolean;
  status: string;
};

export type PongGameViewModel = {
  players: PongPlayerView[];
  status: string;
  prompt: string;
  pending: boolean;
  isLoggedIn: boolean;
  showJoin: boolean;
  canJoin: boolean;
  canLeave: boolean;
  showRematch: boolean;
  canRematch: boolean;
  rematchReady: boolean;
  canControl: boolean;
};

export type PongGameControls = {
  renderView: (view: PongGameViewModel) => void;
};

const defaultControls: PongGameControls = {
  renderView: () => {},
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isActivePhase = (phase: PongPhase): boolean =>
  phase === 'countdown' || phase === 'playing' || phase === 'paused';

const emptyRenderCorrection = (): PongRenderPositions => ({
  leftPaddleY: 0,
  rightPaddleY: 0,
  ballX: 0,
  ballY: 0,
});

const pongScoresChanged = (
  previous: PongGameState,
  next: PongGameState
): boolean =>
  previous.players.left?.score !== next.players.left?.score ||
  previous.players.right?.score !== next.players.right?.score;

const pongSeatsChanged = (
  previous: PongGameState,
  next: PongGameState
): boolean =>
  previous.players.left?.playerId !== next.players.left?.playerId ||
  previous.players.right?.playerId !== next.players.right?.playerId;

const directionChanged = (previous: number, next: number): boolean =>
  previous !== 0 && next !== 0 && previous * next < 0;

const isStoppedPhase = (phase: PongPhase): boolean =>
  phase === 'lobby' || phase === 'paused' || phase === 'finished';

class PongScene extends Phaser.Scene {
  controls: PongGameControls;
  state: PongGameState | undefined;
  selfPlayerId: string | null = null;
  active = false;
  connected = false;
  actionPending = false;
  snapshotInFlight = false;
  syncInFlight = false;
  syncQueued = false;
  syncFailureCount = 0;
  nextSyncAllowedAt = 0;
  syncIntervalJitterMs = Math.floor(Math.random() * 101) - 50;
  inputSeq = 0;
  keyboardUp = false;
  keyboardDown = false;
  touchAxis: PongAxis = 0;
  currentAxis: PongAxis = 0;
  axisChangedAt = Date.now();
  serverOffsetMs = 0;
  hasClockOffsetSample = false;
  lastAuthoritativeAt = 0;
  lastSyncStartedAt = 0;
  hardSnap = true;
  renderCorrection = emptyRenderCorrection();
  feedback = '';
  lastViewKey = '';
  leftPaddle!: Phaser.GameObjects.Rectangle;
  rightPaddle!: Phaser.GameObjects.Rectangle;
  ball!: Phaser.GameObjects.Arc;
  leftScore!: Phaser.GameObjects.Text;
  rightScore!: Phaser.GameObjects.Text;
  leftName!: Phaser.GameObjects.Text;
  rightName!: Phaser.GameObjects.Text;
  centerMessage!: Phaser.GameObjects.Text;
  networkTimer: Phaser.Time.TimerEvent | undefined;
  snapshotTimer: Phaser.Time.TimerEvent | undefined;
  viewTimer: Phaser.Time.TimerEvent | undefined;
  unsubscribeRealtime: (() => void) | undefined;
  unsubscribeConnection: (() => void) | undefined;

  constructor(controls: PongGameControls) {
    super('PongScene');
    this.controls = controls;
  }

  create() {
    this.active = true;
    registerCurrentScene(this);
    this.cameras.main.setBackgroundColor(0x000000);
    this.drawCourt();
    this.createGameObjects();

    this.unsubscribeRealtime = onPongGameMessage((message) => {
      if (this.active)
        this.applyState(message.state, undefined, message.sentAt);
    });
    this.unsubscribeConnection = onPongGameConnectionChange((connected) => {
      if (!this.active) return;
      this.connected = connected;
      if (connected) void this.loadSnapshot(false);
      this.publishView(true);
    });

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('focus', this.handleFocus);
    window.addEventListener('pageshow', this.handlePageShow);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());

    this.networkTimer = this.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => this.maybeSync(),
    });
    this.snapshotTimer = this.time.addEvent({
      delay: PONG_SNAPSHOT_INTERVAL_MS,
      loop: true,
      callback: () => void this.loadSnapshot(false),
    });
    this.viewTimer = this.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => this.publishView(),
    });

    this.publishView(true);
    void this.loadSnapshot();
  }

  override update(_time: number, delta: number) {
    const state = this.state;
    if (!this.active || !state) return;

    const stale = this.isRenderStale();
    if (stale) {
      this.renderState(state, undefined, delta, true);
      return;
    }

    const frame = this.predictRenderFrame(
      state,
      this.serverNow(),
      this.selfPlayerId,
      this.serverOffsetMs
    );
    this.renderState(frame.state, frame.positions, delta, false);
  }

  drawCourt() {
    const graphics = this.add.graphics();
    graphics.lineStyle(3, 0xffffff, 0.9);
    graphics.strokeRect(2, 2, PONG_WORLD_WIDTH - 4, PONG_WORLD_HEIGHT - 4);
    graphics.lineStyle(4, 0xffffff, 0.55);
    for (let y = 14; y < PONG_WORLD_HEIGHT; y += 28) {
      graphics.lineBetween(
        PONG_WORLD_WIDTH / 2,
        y,
        PONG_WORLD_WIDTH / 2,
        y + 14
      );
    }
  }

  createGameObjects() {
    const paddleY = PONG_WORLD_HEIGHT / 2;
    const leftX = PONG_PADDLE_MARGIN + PONG_PADDLE_WIDTH / 2;
    const rightX =
      PONG_WORLD_WIDTH - PONG_PADDLE_MARGIN - PONG_PADDLE_WIDTH / 2;
    this.leftPaddle = this.add
      .rectangle(
        leftX,
        paddleY,
        PONG_PADDLE_WIDTH,
        PONG_PADDLE_HEIGHT,
        0xffffff
      )
      .setDepth(3);
    this.rightPaddle = this.add
      .rectangle(
        rightX,
        paddleY,
        PONG_PADDLE_WIDTH,
        PONG_PADDLE_HEIGHT,
        0xffffff
      )
      .setDepth(3);
    this.ball = this.add
      .circle(
        PONG_WORLD_WIDTH / 2,
        PONG_WORLD_HEIGHT / 2,
        PONG_BALL_RADIUS,
        0xffffff
      )
      .setDepth(4);

    const scoreStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'Courier New',
      fontSize: 64,
      color: '#ffffff',
      fontStyle: 'bold',
    };
    this.leftScore = this.add
      .text(PONG_WORLD_WIDTH / 2 - 92, 32, '0', scoreStyle)
      .setOrigin(0.5, 0);
    this.rightScore = this.add
      .text(PONG_WORLD_WIDTH / 2 + 92, 32, '0', scoreStyle)
      .setOrigin(0.5, 0);
    const nameStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'Courier New',
      fontSize: 18,
      color: '#d4d4d8',
    };
    this.leftName = this.add.text(22, 14, 'LEFT OPEN', nameStyle);
    this.rightName = this.add
      .text(PONG_WORLD_WIDTH - 22, 14, 'RIGHT OPEN', nameStyle)
      .setOrigin(1, 0);
    this.centerMessage = this.add
      .text(PONG_WORLD_WIDTH / 2, PONG_WORLD_HEIGHT / 2, '', {
        fontFamily: 'Courier New',
        fontSize: 42,
        color: '#ffffff',
        align: 'center',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(8);
  }

  serverNow(): number {
    return Date.now() - this.serverOffsetMs;
  }

  isRenderStale(): boolean {
    return (
      isActivePhase(this.state?.phase ?? 'lobby') &&
      Date.now() - this.lastAuthoritativeAt > PONG_RENDER_STALE_MS
    );
  }

  predictRenderFrame(
    state: PongGameState,
    targetAt: number,
    selfPlayerId: string | null,
    serverOffsetMs: number
  ): PongRenderFrame {
    let predictionBase = state;
    const selfSide = pongPlayerSide(state, selfPlayerId);
    if (selfSide && isActivePhase(state.phase)) {
      const player = state.players[selfSide];
      if (player && this.inputSeq > player.inputSeq) {
        const inputAt = Math.min(
          targetAt,
          Math.max(state.simulatedAt, this.axisChangedAt - serverOffsetMs)
        );
        predictionBase = advancePongGame(state, inputAt);
        predictionBase = setPongPlayerInput(
          predictionBase,
          player.playerId,
          this.inputSeq,
          this.currentAxis,
          inputAt
        );
      }
    }
    return getPongRenderFrame(predictionBase, targetAt);
  }

  resetRenderCorrection() {
    this.renderCorrection = emptyRenderCorrection();
  }

  setRenderCorrection(
    correction: PongRenderPositions,
    state: PongGameState,
    selfPlayerId: string | null,
    snapBall: boolean
  ) {
    const selfSide = pongPlayerSide(state, selfPlayerId);
    const leftThreshold =
      selfSide === 'left'
        ? PONG_LOCAL_PADDLE_SNAP_DISTANCE
        : PONG_REMOTE_PADDLE_SNAP_DISTANCE;
    const rightThreshold =
      selfSide === 'right'
        ? PONG_LOCAL_PADDLE_SNAP_DISTANCE
        : PONG_REMOTE_PADDLE_SNAP_DISTANCE;

    this.renderCorrection.leftPaddleY =
      Math.abs(correction.leftPaddleY) > leftThreshold
        ? 0
        : correction.leftPaddleY;
    this.renderCorrection.rightPaddleY =
      Math.abs(correction.rightPaddleY) > rightThreshold
        ? 0
        : correction.rightPaddleY;
    if (
      snapBall ||
      Math.hypot(correction.ballX, correction.ballY) > PONG_BALL_SNAP_DISTANCE
    ) {
      this.renderCorrection.ballX = 0;
      this.renderCorrection.ballY = 0;
    } else {
      this.renderCorrection.ballX = correction.ballX;
      this.renderCorrection.ballY = correction.ballY;
    }
  }

  reconcileFromDisplayedPositions(
    target: PongRenderPositions,
    state: PongGameState,
    selfPlayerId: string | null,
    snapBall: boolean
  ) {
    this.setRenderCorrection(
      {
        leftPaddleY: this.leftPaddle.y - target.leftPaddleY,
        rightPaddleY: this.rightPaddle.y - target.rightPaddleY,
        ballX: this.ball.x - target.ballX,
        ballY: this.ball.y - target.ballY,
      },
      state,
      selfPlayerId,
      snapBall
    );
  }

  reconcilePredictedTrajectories(
    previous: PongRenderPositions,
    next: PongRenderPositions,
    state: PongGameState,
    selfPlayerId: string | null,
    snapBall: boolean
  ) {
    this.setRenderCorrection(
      {
        leftPaddleY:
          this.renderCorrection.leftPaddleY +
          previous.leftPaddleY -
          next.leftPaddleY,
        rightPaddleY:
          this.renderCorrection.rightPaddleY +
          previous.rightPaddleY -
          next.rightPaddleY,
        ballX: this.renderCorrection.ballX + previous.ballX - next.ballX,
        ballY: this.renderCorrection.ballY + previous.ballY - next.ballY,
      },
      state,
      selfPlayerId,
      snapBall
    );
  }

  decayRenderCorrection(delta: number) {
    const selfSide = this.state
      ? pongPlayerSide(this.state, this.selfPlayerId)
      : null;
    const leftDuration =
      selfSide === 'left'
        ? PONG_LOCAL_PADDLE_CORRECTION_MS
        : PONG_REMOTE_PADDLE_CORRECTION_MS;
    const rightDuration =
      selfSide === 'right'
        ? PONG_LOCAL_PADDLE_CORRECTION_MS
        : PONG_REMOTE_PADDLE_CORRECTION_MS;
    const dampCorrection = (value: number, duration: number): number => {
      const next = dampValue(
        value,
        0,
        exponentialDampingAlpha(delta, duration)
      );
      return Math.abs(next) < PONG_CORRECTION_EPSILON ? 0 : next;
    };

    this.renderCorrection.leftPaddleY = dampCorrection(
      this.renderCorrection.leftPaddleY,
      leftDuration
    );
    this.renderCorrection.rightPaddleY = dampCorrection(
      this.renderCorrection.rightPaddleY,
      rightDuration
    );
    this.renderCorrection.ballX = dampCorrection(
      this.renderCorrection.ballX,
      PONG_BALL_CORRECTION_MS
    );
    this.renderCorrection.ballY = dampCorrection(
      this.renderCorrection.ballY,
      PONG_BALL_CORRECTION_MS
    );
  }

  renderState(
    state: PongGameState,
    positions: PongRenderPositions | undefined,
    delta: number,
    stale: boolean
  ) {
    if (positions) {
      if (this.hardSnap) {
        this.resetRenderCorrection();
      } else {
        this.decayRenderCorrection(delta);
      }
      this.leftPaddle.y =
        positions.leftPaddleY + this.renderCorrection.leftPaddleY;
      this.rightPaddle.y =
        positions.rightPaddleY + this.renderCorrection.rightPaddleY;
      this.ball.x = positions.ballX + this.renderCorrection.ballX;
      this.ball.y = positions.ballY + this.renderCorrection.ballY;
      this.hardSnap = false;
    }
    this.ball.setVisible(state.phase !== 'lobby');

    const authoritative = this.state ?? state;
    this.leftScore.setText(String(authoritative.players.left?.score ?? 0));
    this.rightScore.setText(String(authoritative.players.right?.score ?? 0));
    this.leftName.setText(authoritative.players.left?.username ?? 'LEFT OPEN');
    this.rightName.setText(
      authoritative.players.right?.username ?? 'RIGHT OPEN'
    );
    this.centerMessage.setText(this.centerText(state, authoritative, stale));
  }

  centerText(
    state: PongGameState,
    authoritative: PongGameState,
    stale: boolean
  ): string {
    if (stale) return 'RECONNECTING…';
    if (state.phase === 'lobby') return 'WAITING FOR PLAYERS';
    if (state.phase === 'paused') return 'PAUSED';
    if (authoritative.phase === 'finished') {
      const winner = PONG_SIDES.map((side) => authoritative.players[side]).find(
        (player) => player?.playerId === authoritative.winnerPlayerId
      );
      return winner ? `${winner.username}\nWINS` : 'MATCH OVER';
    }
    if (state.phase === 'finished') return 'SYNCING SCORE…';
    if (state.phase === 'countdown' && state.countdown) {
      return String(
        Math.max(
          1,
          Math.ceil((state.countdown.endsAt - this.serverNow()) / 1_000)
        )
      );
    }
    return '';
  }

  applyState(
    state: PongGameState,
    selfPlayerId: string | null | undefined,
    serverNow: number,
    localClockAt?: number
  ) {
    if (!this.active) return;
    if (this.state && state.version < this.state.version) return;
    const previous = this.state;
    const previousSelfPlayerId = this.selfPlayerId;
    const nextSelfPlayerId =
      selfPlayerId === undefined ? this.selfPlayerId : selfPlayerId;
    const localNow = Date.now();
    const wasRenderStale = Boolean(
      previous &&
      isActivePhase(previous.phase) &&
      localNow - this.lastAuthoritativeAt > PONG_RENDER_STALE_MS
    );
    const previousOffsetMs = this.serverOffsetMs;
    if (localClockAt !== undefined) {
      const measuredOffsetMs = localClockAt - serverNow;
      this.serverOffsetMs = this.hasClockOffsetSample
        ? previousOffsetMs +
          (measuredOffsetMs - previousOffsetMs) * PONG_CLOCK_OFFSET_SMOOTHING
        : measuredOffsetMs;
      this.hasClockOffsetSample = true;
    }

    const offsetChanged = this.serverOffsetMs !== previousOffsetMs;
    const versionChanged = Boolean(
      !previous || state.version > previous.version
    );
    const snapAll = Boolean(
      !previous ||
      previous.matchId !== state.matchId ||
      pongSeatsChanged(previous, state)
    );
    if (snapAll) {
      this.hardSnap = true;
      this.resetRenderCorrection();
    } else if (
      previous &&
      !this.hardSnap &&
      (versionChanged || offsetChanged || wasRenderStale)
    ) {
      const previousRenderAt = localNow - previousOffsetMs;
      const nextRenderAt = localNow - this.serverOffsetMs;
      const previousFrame = this.predictRenderFrame(
        previous,
        previousRenderAt,
        previousSelfPlayerId,
        previousOffsetMs
      );
      const nextFrame = this.predictRenderFrame(
        state,
        nextRenderAt,
        nextSelfPlayerId,
        this.serverOffsetMs
      );
      const stoppedPhaseTransition =
        previous.phase !== state.phase &&
        (isStoppedPhase(previous.phase) || isStoppedPhase(state.phase));
      const contradictoryCollision =
        previousFrame.state.phase === 'playing' &&
        nextFrame.state.phase === 'playing' &&
        (directionChanged(
          previousFrame.state.ball.vx,
          nextFrame.state.ball.vx
        ) ||
          directionChanged(
            previousFrame.state.ball.vy,
            nextFrame.state.ball.vy
          ));
      const snapBall =
        pongScoresChanged(previous, state) ||
        stoppedPhaseTransition ||
        previousFrame.state.phase !== nextFrame.state.phase ||
        pongScoresChanged(previousFrame.state, nextFrame.state) ||
        contradictoryCollision;
      if (wasRenderStale) {
        this.reconcileFromDisplayedPositions(
          nextFrame.positions,
          state,
          nextSelfPlayerId,
          snapBall
        );
      } else {
        this.reconcilePredictedTrajectories(
          previousFrame.positions,
          nextFrame.positions,
          state,
          nextSelfPlayerId,
          snapBall
        );
      }
    }

    this.state = state;
    this.selfPlayerId = nextSelfPlayerId;
    this.lastAuthoritativeAt = localNow;

    const selfSide = pongPlayerSide(state, this.selfPlayerId);
    const self = selfSide ? state.players[selfSide] : null;
    if (self) {
      this.inputSeq = Math.max(this.inputSeq, self.inputSeq);
    } else {
      this.currentAxis = 0;
      this.touchAxis = 0;
      this.keyboardUp = false;
      this.keyboardDown = false;
      this.inputSeq = 0;
    }
    this.publishView(true);
  }

  async loadSnapshot(showErrors = true): Promise<void> {
    if (this.snapshotInFlight) return;
    this.snapshotInFlight = true;
    try {
      const requestedAt = Date.now();
      const snapshot = await trpc.pong.snapshot.query();
      const receivedAt = Date.now();
      this.applyState(
        snapshot.state,
        snapshot.selfPlayerId,
        snapshot.serverNow,
        (requestedAt + receivedAt) / 2
      );
    } catch (error) {
      if (!this.active) return;
      console.error('Failed to load Pong snapshot:', error);
      if (showErrors) showToast(`Pong load failed: ${errorMessage(error)}`);
    } finally {
      this.snapshotInFlight = false;
    }
  }

  maybeSync() {
    const state = this.state;
    const side = state ? pongPlayerSide(state, this.selfPlayerId) : null;
    if (!state || !side) return;
    const now = Date.now();
    if (now < this.nextSyncAllowedAt) return;
    const interval =
      (isActivePhase(state.phase)
        ? PONG_ACTIVE_SYNC_INTERVAL_MS
        : PONG_IDLE_SYNC_INTERVAL_MS) + this.syncIntervalJitterMs;
    if (now - this.lastSyncStartedAt >= interval) void this.sync();
  }

  async sync(urgent = false): Promise<void> {
    const state = this.state;
    if (!state || !pongPlayerSide(state, this.selfPlayerId)) return;
    if (Date.now() < this.nextSyncAllowedAt) {
      if (urgent) this.syncQueued = true;
      return;
    }
    if (this.syncInFlight) {
      if (urgent) this.syncQueued = true;
      return;
    }

    this.syncInFlight = true;
    this.syncQueued = false;
    this.lastSyncStartedAt = Date.now();
    const matchId = state.matchId;
    const sentSeq = this.inputSeq;
    const sentAxis = this.currentAxis;
    try {
      const requestedAt = Date.now();
      const result = await trpc.pong.sync.mutate({
        matchId,
        inputSeq: sentSeq,
        axis: sentAxis,
      });
      const receivedAt = Date.now();
      if (!this.active) return;
      this.syncFailureCount = 0;
      this.nextSyncAllowedAt = 0;
      if (this.feedback.startsWith('Sync temporarily busy')) this.feedback = '';
      this.applyState(
        result.state,
        result.selfPlayerId,
        result.serverNow,
        (requestedAt + receivedAt) / 2
      );
      if (!result.accepted && result.reason === 'stale-input') {
        this.inputSeq += 1;
        this.axisChangedAt = Date.now();
        this.syncQueued = true;
      }
      if (!result.accepted && result.reason === 'stale-match') {
        this.feedback = 'The match changed; controls were resynchronized.';
      }
      if (this.inputSeq > sentSeq || this.currentAxis !== sentAxis) {
        this.syncQueued = true;
      }
    } catch (error) {
      if (!this.active) return;
      this.syncFailureCount += 1;
      const backoffMs =
        Math.min(
          Math.floor(PONG_STALE_MS / 3),
          200 * 2 ** Math.min(4, this.syncFailureCount - 1)
        ) + Math.floor(Math.random() * 100);
      this.nextSyncAllowedAt = Date.now() + backoffMs;
      this.syncQueued = true;
      this.feedback = `Sync temporarily busy; retrying in ${Math.ceil(backoffMs / 1_000)}s.`;
      console.warn('Pong sync temporarily failed; backing off:', error);
      this.publishView(true);
    } finally {
      this.syncInFlight = false;
      if (
        this.active &&
        this.syncQueued &&
        Date.now() >= this.nextSyncAllowedAt
      ) {
        this.syncQueued = false;
        void this.sync(true);
      }
    }
  }

  async join(): Promise<void> {
    if (this.actionPending) return;
    this.actionPending = true;
    this.feedback = 'Joining the Pong room...';
    this.publishView(true);
    try {
      const requestedAt = Date.now();
      const result = await trpc.pong.join.mutate();
      const receivedAt = Date.now();
      if (!this.active) return;
      this.applyState(
        result.state,
        result.selfPlayerId,
        result.serverNow,
        (requestedAt + receivedAt) / 2
      );
      this.feedback = result.joined ? '' : 'Both paddles are already claimed.';
      if (!result.joined) showToast(this.feedback);
    } catch (error) {
      if (!this.active) return;
      this.feedback = `Unable to join: ${errorMessage(error)}`;
      console.error('Failed to join Pong:', error);
      showToast(this.feedback);
    } finally {
      if (this.active) {
        this.actionPending = false;
        this.publishView(true);
      }
    }
  }

  async leave(): Promise<void> {
    if (this.actionPending) return;
    this.currentAxis = 0;
    this.touchAxis = 0;
    this.keyboardUp = false;
    this.keyboardDown = false;
    this.inputSeq += 1;
    this.axisChangedAt = Date.now();
    this.actionPending = true;
    this.feedback = 'Leaving the match...';
    this.publishView(true);
    try {
      const requestedAt = Date.now();
      const result = await trpc.pong.leave.mutate();
      const receivedAt = Date.now();
      if (!this.active) return;
      this.applyState(
        result.state,
        result.selfPlayerId,
        result.serverNow,
        (requestedAt + receivedAt) / 2
      );
      this.feedback = result.left ? 'You left the Pong room.' : '';
    } catch (error) {
      if (!this.active) return;
      this.feedback = `Unable to leave: ${errorMessage(error)}`;
      console.error('Failed to leave Pong:', error);
      showToast(this.feedback);
    } finally {
      if (this.active) {
        this.actionPending = false;
        this.publishView(true);
      }
    }
  }

  async requestRematch(): Promise<void> {
    if (this.actionPending) return;
    this.actionPending = true;
    this.feedback = 'Requesting a rematch...';
    this.publishView(true);
    try {
      const requestedAt = Date.now();
      const result = await trpc.pong.requestRematch.mutate();
      const receivedAt = Date.now();
      if (!this.active) return;
      this.applyState(
        result.state,
        result.selfPlayerId,
        result.serverNow,
        (requestedAt + receivedAt) / 2
      );
      this.feedback = result.accepted ? '' : 'Rematch is not available.';
      if (!result.accepted) showToast(this.feedback);
    } catch (error) {
      if (!this.active) return;
      this.feedback = `Rematch failed: ${errorMessage(error)}`;
      console.error('Failed to request Pong rematch:', error);
      showToast(this.feedback);
    } finally {
      if (this.active) {
        this.actionPending = false;
        this.publishView(true);
      }
    }
  }

  setTouchAxis(axis: PongAxis) {
    this.touchAxis = axis;
    this.refreshAxis();
  }

  setAxis(axis: PongAxis) {
    if (axis === this.currentAxis) return;
    this.currentAxis = axis;
    this.inputSeq += 1;
    this.axisChangedAt = Date.now();
    if (!this.feedback.startsWith('Sync temporarily busy')) this.feedback = '';
    this.publishView(true);
    void this.sync(true);
  }

  refreshAxis() {
    const keyboardAxis: PongAxis =
      this.keyboardUp === this.keyboardDown ? 0 : this.keyboardUp ? -1 : 1;
    this.setAxis(this.touchAxis !== 0 ? this.touchAxis : keyboardAxis);
  }

  isControlKey(event: KeyboardEvent): boolean {
    return (
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown' ||
      event.key.toLowerCase() === 'w' ||
      event.key.toLowerCase() === 's'
    );
  }

  handleKeyDown = (event: KeyboardEvent) => {
    if (!this.isControlKey(event)) return;
    if (!this.state || !pongPlayerSide(this.state, this.selfPlayerId)) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') {
      this.keyboardUp = true;
    } else {
      this.keyboardDown = true;
    }
    this.refreshAxis();
  };

  handleKeyUp = (event: KeyboardEvent) => {
    if (!this.isControlKey(event)) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') {
      this.keyboardUp = false;
    } else {
      this.keyboardDown = false;
    }
    this.refreshAxis();
  };

  handleBlur = () => {
    this.keyboardUp = false;
    this.keyboardDown = false;
    this.touchAxis = 0;
    this.refreshAxis();
  };

  handleFocus = () => {
    void this.loadSnapshot(false);
  };

  handlePageShow = () => {
    void this.loadSnapshot(false);
  };

  handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') void this.loadSnapshot(false);
  };

  playerStatus(state: PongGameState, side: PongSide): string {
    const player = state.players[side];
    if (!player) return 'Open';
    if (state.winnerPlayerId === player.playerId) {
      return state.finishReason === 'forfeit' ? 'Winner by forfeit' : 'Winner';
    }
    if (player.rematchReady) return 'Rematch ready';
    if (
      state.phase === 'paused' &&
      !isFreshForView(player.lastSeenAt, this.serverNow())
    )
      return 'Disconnected';
    if (state.phase === 'playing') return 'Playing';
    if (state.phase === 'countdown') return 'Get ready';
    return 'Waiting';
  }

  publishView(force = false) {
    const state = this.state;
    const selfSide = state ? pongPlayerSide(state, this.selfPlayerId) : null;
    const self = selfSide && state ? state.players[selfSide] : null;
    const stale = this.isRenderStale();
    const openSeat = Boolean(
      state && (!state.players.left || !state.players.right)
    );
    const players: PongPlayerView[] = [];
    if (state) {
      for (const side of PONG_SIDES) {
        const player = state.players[side];
        if (!player) continue;
        players.push({
          side,
          username: player.username,
          score: player.score,
          isSelf: player.playerId === this.selfPlayerId,
          status: this.playerStatus(state, side),
        });
      }
    }

    let status = 'Loading the Pong room...';
    if (stale)
      status = 'Connection interrupted. Freezing the local prediction.';
    else if (state?.phase === 'lobby') {
      status = players.length
        ? `${players[0]?.username ?? 'A player'} joined. Waiting for an opponent.`
        : 'Two players are needed. Both paddles are open.';
    } else if (state?.phase === 'countdown') status = 'Match starting...';
    else if (state?.phase === 'playing') status = 'Match in progress.';
    else if (state?.phase === 'paused')
      status = 'Match paused while a player reconnects.';
    else if (state?.phase === 'finished') {
      const winner = players.find(
        (player) =>
          state.players[player.side]?.playerId === state.winnerPlayerId
      );
      status = winner ? `${winner.username} wins!` : 'Match finished.';
    }

    let prompt = this.feedback;
    if (!prompt) {
      if (!state) prompt = 'Please wait.';
      else if (!self)
        prompt = openSeat
          ? 'Click Join to claim a paddle.'
          : 'Both paddles are claimed. You are spectating.';
      else if (state.phase === 'lobby')
        prompt = 'Waiting for another player to join.';
      else if (state.phase === 'countdown')
        prompt = 'Get ready. Use W/S, arrow keys, or the touch controls.';
      else if (state.phase === 'playing')
        prompt = 'Move your paddle with W/S, arrow keys, or touch.';
      else if (state.phase === 'paused')
        prompt = 'The rally will resume if both players reconnect in time.';
      else if (self.rematchReady)
        prompt = 'Waiting for your opponent to accept the rematch.';
      else prompt = 'Request a rematch or leave the room.';
    }

    const view: PongGameViewModel = {
      players,
      status,
      prompt,
      pending: this.actionPending,
      isLoggedIn: Boolean(context.userId),
      showJoin: !self && openSeat,
      canJoin: Boolean(
        context.userId && !self && openSeat && !this.actionPending
      ),
      canLeave: Boolean(self),
      showRematch: Boolean(
        self &&
        state?.phase === 'finished' &&
        state.players.left &&
        state.players.right
      ),
      canRematch: Boolean(
        self &&
        state?.phase === 'finished' &&
        !self.rematchReady &&
        !this.actionPending
      ),
      rematchReady: Boolean(self?.rematchReady),
      canControl: Boolean(
        self &&
        state &&
        (state.phase === 'playing' || state.phase === 'countdown') &&
        !stale
      ),
    };
    const viewKey = JSON.stringify(view);
    if (!force && viewKey === this.lastViewKey) return;
    this.lastViewKey = viewKey;
    this.controls.renderView(view);
  }

  cleanup() {
    this.active = false;
    if (currentScene === this) currentScene = undefined;
    this.unsubscribeRealtime?.();
    this.unsubscribeConnection?.();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    window.removeEventListener('focus', this.handleFocus);
    window.removeEventListener('pageshow', this.handlePageShow);
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange
    );
    this.networkTimer?.remove(false);
    this.snapshotTimer?.remove(false);
    this.viewTimer?.remove(false);
  }
}

const isFreshForView = (lastSeenAt: number, now: number): boolean =>
  now - lastSeenAt < PONG_STALE_MS;

const config = (controls: PongGameControls): Phaser.Types.Core.GameConfig => ({
  type: Phaser.AUTO,
  audio: { noAudio: true },
  backgroundColor: '#000000',
  render: { roundPixels: true },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: PONG_WORLD_WIDTH,
    height: PONG_WORLD_HEIGHT,
  },
  scene: [new PongScene(controls)],
});

let currentGame: Phaser.Game | undefined;
let currentScene: PongScene | undefined;

const registerCurrentScene = (scene: PongScene): void => {
  currentScene = scene;
};

export const startPongGame = (
  parentId: string,
  controls: PongGameControls = defaultControls
): Phaser.Game => {
  traceClientLog('Starting Pong game:', parentId);
  currentGame?.destroy(true);
  currentGame = new Phaser.Game({ ...config(controls), parent: parentId });
  return currentGame;
};

export const stopPongGame = (): void => {
  if (currentGame) traceClientLog('Stopping Pong game.');
  currentGame?.destroy(true);
  currentGame = undefined;
  currentScene = undefined;
};

export const joinPongGame = async (): Promise<void> => {
  await currentScene?.join();
};

export const leavePongGame = async (): Promise<void> => {
  await currentScene?.leave();
};

export const requestPongRematch = async (): Promise<void> => {
  await currentScene?.requestRematch();
};

export const setPongTouchAxis = (axis: PongAxis): void => {
  currentScene?.setTouchAxis(axis);
};
