import { showToast } from '@devvit/web/client';
import * as Phaser from 'phaser';
import { onBallLeaveMessage, onBallMoveMessage } from './realtimeChannel';
import { traceClientLog } from './clientLogs';
import { trpc } from './trpc';
import {
  BALL_MARGIN,
  BALL_STALE_MS,
  BALL_WORLD_HEIGHT,
  BALL_WORLD_WIDTH,
  type BallPoint,
  type RealtimeBallMoveMessage,
} from '../shared/realtime';

const BALL_RADIUS = 18;
const AUTO_MOVE_DELAY_MS = 650;
const SNAPSHOT_DELAY_MS = 1_000;
const smoothMovementClientId = crypto.randomUUID();

export type SmoothMovementControls = {
  setColor: (color: string) => void;
};

const defaultControls: SmoothMovementControls = {
  setColor: () => {},
};

type BallView = {
  dot: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  username: string;
  color: string;
  lastSeq: number;
  lastSeenAt: number;
  tween: Phaser.Tweens.Tween | undefined;
};

const clampPoint = (point: BallPoint): BallPoint => ({
  x: Math.round(
    Math.min(BALL_WORLD_WIDTH - BALL_MARGIN, Math.max(BALL_MARGIN, point.x))
  ),
  y: Math.round(
    Math.min(BALL_WORLD_HEIGHT - BALL_MARGIN, Math.max(BALL_MARGIN, point.y))
  ),
});

const randomPoint = (): BallPoint => ({
  x:
    BALL_MARGIN +
    Math.round(Math.random() * (BALL_WORLD_WIDTH - BALL_MARGIN * 2)),
  y:
    BALL_MARGIN +
    Math.round(Math.random() * (BALL_WORLD_HEIGHT - BALL_MARGIN * 2)),
});

const colorNumber = (color: string) => {
  const parsed = Number.parseInt(color.slice(1), 16);
  return Number.isFinite(parsed) ? parsed : 0x38bdf8;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

class SmoothMovementScene extends Phaser.Scene {
  controls: SmoothMovementControls;
  playerId: string | undefined;
  balls = new Map<string, BallView>();
  localMoving = false;
  moveInFlight = false;
  joinInFlight = false;
  leaveInFlight = false;
  leavePromise: Promise<void> | undefined;
  presenceRegistered = false;
  colorChangeInFlight = false;
  joined = false;
  active = false;
  unsubscribeRealtime: (() => void) | undefined;
  unsubscribeBallLeave: (() => void) | undefined;
  autoMoveTimer: Phaser.Time.TimerEvent | undefined;
  snapshotTimer: Phaser.Time.TimerEvent | undefined;
  statusText!: Phaser.GameObjects.Text;

  constructor(controls: SmoothMovementControls) {
    super('SmoothMovementScene');
    this.controls = controls;
  }

  create() {
    this.active = true;
    registerCurrentScene(this);
    this.cameras.main.setBackgroundColor(0x101624);
    this.drawBackdrop();

    this.statusText = this.add.text(20, 18, 'Joining...', {
      fontFamily: 'Arial',
      fontSize: 16,
      color: '#cbd5e1',
    });

    this.add
      .text(
        BALL_WORLD_WIDTH - 20,
        18,
        'Server accepts moves, then every client tweens the result.',
        {
          fontFamily: 'Arial',
          fontSize: 16,
          color: '#94a3b8',
        }
      )
      .setOrigin(1, 0);

    this.unsubscribeRealtime = onBallMoveMessage((message) => {
      if (this.active) this.applyMove(message);
    });
    this.unsubscribeBallLeave = onBallLeaveMessage((message) => {
      if (!this.active) return;
      const ball = this.balls.get(message.playerId);
      if (ball) this.destroyBall(message.playerId, ball);
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.joined || this.localMoving || this.moveInFlight) return;
      this.autoMoveTimer?.remove(false);
      void this.requestMove(
        clampPoint({ x: pointer.worldX, y: pointer.worldY })
      );
    });

    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pageshow', this.handlePageShow);
    window.addEventListener('pagehide', this.handlePageHide);
    window.addEventListener('beforeunload', this.handleBeforeUnload);

    void this.join();
  }

  handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') void this.join();
    else void this.leavePresence();
  };

  handlePageShow = () => {
    void this.join();
  };

  handlePageHide = () => {
    void this.leavePresence();
  };

  handleBeforeUnload = () => {
    void this.leavePresence();
  };

  override update() {
    if (!this.active) return;

    const now = Date.now();
    for (const [playerId, ball] of this.balls) {
      if (playerId !== this.playerId && now - ball.lastSeenAt > BALL_STALE_MS) {
        this.destroyBall(playerId, ball);
      }
    }
  }

  drawBackdrop() {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, 0x263244, 0.6);
    for (let x = 0; x <= BALL_WORLD_WIDTH; x += 64) {
      graphics.lineBetween(x, 0, x, BALL_WORLD_HEIGHT);
    }
    for (let y = 0; y <= BALL_WORLD_HEIGHT; y += 64) {
      graphics.lineBetween(0, y, BALL_WORLD_WIDTH, y);
    }
    graphics.strokeRect(
      BALL_MARGIN,
      BALL_MARGIN,
      BALL_WORLD_WIDTH - BALL_MARGIN * 2,
      BALL_WORLD_HEIGHT - BALL_MARGIN * 2
    );
  }

  setStatus(text: string) {
    if (this.active) this.statusText.setText(text);
  }

  canJoinPresence(): boolean {
    return this.active && document.visibilityState === 'visible';
  }

  async join() {
    if (this.joinInFlight) return;

    this.joinInFlight = true;
    traceClientLog('Joining smooth movement demo.');
    try {
      await this.leavePromise;
      if (!this.canJoinPresence()) return;
      const snapshot = await trpc.realtime.joinBall.mutate({
        clientId: smoothMovementClientId,
      });
      if (!this.canJoinPresence()) {
        this.presenceRegistered = true;
        void this.leavePresence();
        return;
      }

      this.playerId = snapshot.selfPlayerId;
      this.controls.setColor(snapshot.selfColor);
      for (const move of snapshot.moves) this.applyMove(move);
      this.joined = true;
      this.presenceRegistered = true;
      this.setStatus('Connected. Server-authoritative movement is running.');
      console.info('Joined smooth movement demo.');
      this.scheduleSnapshot();
      this.scheduleAutoMove();
    } catch (error) {
      if (!this.active) return;

      const message = errorMessage(error);
      this.setStatus(`Unable to join: ${message}`);
      console.error('Failed to join smooth movement demo:', error);
      showToast(`Unable to join movement demo: ${message}`);
    } finally {
      if (this.active) this.joinInFlight = false;
    }
  }

  leavePresence(): Promise<void> {
    if (!this.presenceRegistered || this.leaveInFlight) {
      return this.leavePromise ?? Promise.resolve();
    }

    this.presenceRegistered = false;
    this.leaveInFlight = true;
    const request = trpc.realtime.leaveBall
      .mutate({ clientId: smoothMovementClientId })
      .then(() => undefined)
      .catch((error) => {
        console.debug('Failed to leave smooth movement demo:', error);
        if (this.active && document.visibilityState === 'visible') {
          this.presenceRegistered = true;
        }
      })
      .finally(() => {
        this.leaveInFlight = false;
        if (this.leavePromise === request) this.leavePromise = undefined;
      });
    this.leavePromise = request;
    return request;
  }

  async requestMove(to: BallPoint) {
    if (this.moveInFlight) return;

    this.moveInFlight = true;
    let blockedByOtherClient = false;
    this.setStatus('Requesting move...');
    try {
      const result = await trpc.realtime.moveBall.mutate({
        to,
        clientId: smoothMovementClientId,
      });
      if (!this.active) return;

      if (!result.accepted) {
        blockedByOtherClient = result.movingClientId !== smoothMovementClientId;
        if (blockedByOtherClient) void this.refreshSnapshot();
        return;
      }
      this.applyMove(result.message);
    } catch (error) {
      if (!this.active) return;

      const message = errorMessage(error);
      this.localMoving = false;
      this.setStatus(`Move failed: ${message}`);
      console.error('Failed to request smooth movement:', error);
      showToast(`Move failed: ${message}`);
    } finally {
      if (this.active) {
        this.moveInFlight = false;
        if (!this.localMoving && !blockedByOtherClient) {
          this.setStatus(
            'Connected. Server-authoritative movement is running.'
          );
          this.scheduleAutoMove();
        }
      }
    }
  }

  async setColor(color: string): Promise<void> {
    if (!this.active || this.colorChangeInFlight) return;

    this.colorChangeInFlight = true;
    try {
      const result = await trpc.realtime.setBallColor.mutate({ color });
      if (!this.active) return;

      this.controls.setColor(result.color);
      if (result.message) this.applyMove(result.message);
    } catch (error) {
      if (this.active) {
        console.error('Failed to set smooth movement color:', error);
        showToast(`Color update failed: ${errorMessage(error)}`);
      }
    } finally {
      this.colorChangeInFlight = false;
    }
  }

  finishLocalMove() {
    this.localMoving = false;
    this.setStatus('Connected. Server-authoritative movement is running.');
    if (!this.moveInFlight) this.scheduleAutoMove();
  }

  applyMove(message: RealtimeBallMoveMessage) {
    if (!this.active) return;

    const isLocal = message.playerId === this.playerId;
    let ball = this.balls.get(message.playerId);
    if (!ball) {
      ball = this.createBall(message);
      this.balls.set(message.playerId, ball);
    }

    if (message.seq < ball.lastSeq) return;

    ball.lastSeenAt = Date.now();
    ball.username = message.username;
    ball.color = message.color;
    ball.dot.setFillStyle(colorNumber(message.color));
    ball.label.setText(message.username);
    ball.ring.setVisible(isLocal);
    ball.label.setColor(isLocal ? '#ffffff' : '#cbd5e1');
    if (isLocal) this.controls.setColor(message.color);

    if (message.seq === ball.lastSeq) return;

    ball.lastSeq = message.seq;
    ball.tween?.stop();

    const setPosition = (x: number, y: number) => {
      ball.dot.setPosition(x, y);
      ball.ring.setPosition(x, y);
      ball.label.setPosition(x, y + BALL_RADIUS + 10);
    };

    setPosition(message.from.x, message.from.y);

    if (message.durationMs === 0) {
      setPosition(message.to.x, message.to.y);
      if (isLocal) this.finishLocalMove();
      return;
    }

    if (isLocal) this.localMoving = true;

    ball.tween = this.tweens.add({
      targets: ball.dot,
      x: message.to.x,
      y: message.to.y,
      duration: message.durationMs,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        if (this.active) setPosition(ball.dot.x, ball.dot.y);
      },
      onComplete: () => {
        if (!this.active) return;

        setPosition(message.to.x, message.to.y);
        ball.tween = undefined;
        if (isLocal) this.finishLocalMove();
      },
    });
  }

  createBall(message: RealtimeBallMoveMessage): BallView {
    const isLocal = message.playerId === this.playerId;
    const dot = this.add.circle(
      message.from.x,
      message.from.y,
      BALL_RADIUS,
      colorNumber(message.color),
      1
    );
    dot.setStrokeStyle(2, 0x0f172a, 0.9);

    const ring = this.add.circle(
      message.from.x,
      message.from.y,
      BALL_RADIUS + 6
    );
    ring.setStrokeStyle(3, 0xffffff, 0.95);
    ring.setVisible(isLocal);

    const label = this.add
      .text(
        message.from.x,
        message.from.y + BALL_RADIUS + 10,
        message.username,
        {
          fontFamily: 'Arial',
          fontSize: 14,
          color: isLocal ? '#ffffff' : '#cbd5e1',
        }
      )
      .setOrigin(0.5, 0);

    return {
      dot,
      ring,
      label,
      username: message.username,
      color: message.color,
      lastSeq: -1,
      lastSeenAt: Date.now(),
      tween: undefined,
    };
  }

  destroyBall(playerId: string, ball: BallView) {
    ball.tween?.stop();
    ball.dot.destroy();
    ball.ring.destroy();
    ball.label.destroy();
    this.balls.delete(playerId);
  }

  scheduleAutoMove() {
    this.autoMoveTimer?.remove(false);
    this.autoMoveTimer = this.time.delayedCall(AUTO_MOVE_DELAY_MS, () => {
      if (!this.joined || this.localMoving || this.moveInFlight) return;
      void this.requestMove(randomPoint());
    });
  }

  scheduleSnapshot() {
    this.snapshotTimer?.remove(false);
    this.snapshotTimer = this.time.addEvent({
      delay: SNAPSHOT_DELAY_MS,
      loop: true,
      callback: () => {
        void this.refreshSnapshot();
      },
    });
  }

  async refreshSnapshot() {
    try {
      const snapshot = await trpc.realtime.ballSnapshot.query();
      if (!this.active) return;

      const activePlayerIds = new Set(
        snapshot.moves.map((move) => move.playerId)
      );
      for (const [playerId, ball] of this.balls) {
        if (playerId !== this.playerId && !activePlayerIds.has(playerId)) {
          this.destroyBall(playerId, ball);
        }
      }
      for (const move of snapshot.moves) this.applyMove(move);
    } catch (error) {
      if (this.active)
        console.error('Failed to refresh movement snapshot:', error);
    }
  }

  cleanup() {
    this.active = false;
    if (currentScene === this) currentScene = undefined;
    this.unsubscribeRealtime?.();
    this.unsubscribeBallLeave?.();
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange
    );
    window.removeEventListener('pageshow', this.handlePageShow);
    window.removeEventListener('pagehide', this.handlePageHide);
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    this.autoMoveTimer?.remove(false);
    this.snapshotTimer?.remove(false);
    for (const [playerId, ball] of [...this.balls]) {
      this.destroyBall(playerId, ball);
    }
    void this.leavePresence();
  }
}

const config = (
  controls: SmoothMovementControls
): Phaser.Types.Core.GameConfig => ({
  type: Phaser.AUTO,
  audio: { noAudio: true },
  backgroundColor: '#101624',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: BALL_WORLD_WIDTH,
    height: BALL_WORLD_HEIGHT,
  },
  scene: [new SmoothMovementScene(controls)],
});

let currentGame: Phaser.Game | undefined;
let currentScene: SmoothMovementScene | undefined;

const registerCurrentScene = (scene: SmoothMovementScene): void => {
  currentScene = scene;
};

export const startSmoothMovementDemo = (
  parentId: string,
  controls: SmoothMovementControls = defaultControls
): Phaser.Game => {
  traceClientLog('Starting smooth movement demo:', parentId);
  currentGame?.destroy(true);
  currentGame = new Phaser.Game({ ...config(controls), parent: parentId });
  console.info('Started smooth movement demo:', parentId);
  return currentGame;
};

export const stopSmoothMovementDemo = (): void => {
  if (currentGame) traceClientLog('Stopping smooth movement demo.');
  currentGame?.destroy(true);
  currentGame = undefined;
  currentScene = undefined;
};

export const setSmoothMovementColor = async (color: string): Promise<void> => {
  await currentScene?.setColor(color);
};
