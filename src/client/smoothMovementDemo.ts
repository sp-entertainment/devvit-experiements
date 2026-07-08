import { showToast } from '@devvit/web/client';
import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { onBallMoveMessage } from './realtimeChannel';
import { trpc } from './trpc';
import {
  BALL_MARGIN,
  BALL_STALE_MS,
  BALL_WORLD_HEIGHT,
  BALL_WORLD_WIDTH,
  type BallPoint,
  type BallState,
  type RealtimeBallMoveMessage,
} from '../shared/realtime';

const BALL_RADIUS = 18;
const AUTO_MOVE_DELAY_MS = 650;
const CLIENT_ID_KEY = 'smooth-movement-client-id';

type BallView = {
  dot: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  lastSeq: number;
  lastSeenAt: number;
  tween: Phaser.Tweens.Tween | undefined;
};

const getClientId = () => {
  const existing = sessionStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;

  const generated = crypto.randomUUID();
  sessionStorage.setItem(CLIENT_ID_KEY, generated);
  return generated;
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

const messageFromState = (ball: BallState): RealtimeBallMoveMessage => ({
  type: 'ballMove',
  clientId: ball.clientId,
  username: ball.username,
  color: ball.color,
  from: { x: ball.x, y: ball.y },
  to: { x: ball.x, y: ball.y },
  durationMs: 0,
  seq: ball.seq,
  sentAt: ball.updatedAt,
});

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

class SmoothMovementScene extends Phaser.Scene {
  clientId = getClientId();
  balls = new Map<string, BallView>();
  localMoving = false;
  joined = false;
  unsubscribeRealtime: (() => void) | undefined;
  autoMoveTimer: Phaser.Time.TimerEvent | undefined;
  statusText: Phaser.GameObjects.Text;

  constructor() {
    super('SmoothMovementScene');
  }

  create() {
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
        'Click or tap while your ringed ball is idle.',
        {
          fontFamily: 'Arial',
          fontSize: 16,
          color: '#94a3b8',
        }
      )
      .setOrigin(1, 0);

    this.unsubscribeRealtime = onBallMoveMessage((message) => {
      this.applyMove(message);
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.joined || this.localMoving) return;
      this.autoMoveTimer?.remove(false);
      void this.requestMove(clampPoint({ x: pointer.worldX, y: pointer.worldY }));
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    void this.join();
  }

  override update() {
    const now = Date.now();
    for (const [clientId, ball] of this.balls) {
      if (
        clientId !== this.clientId &&
        now - ball.lastSeenAt > BALL_STALE_MS
      ) {
        ball.tween?.stop();
        ball.dot.destroy();
        ball.ring.destroy();
        ball.label.destroy();
        this.balls.delete(clientId);
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

  async join() {
    try {
      const snapshot = await trpc.realtime.joinBall.mutate({
        clientId: this.clientId,
      });
      for (const ball of snapshot.balls) {
        this.applyMove(messageFromState(ball));
      }
      this.joined = true;
      this.statusText.setText('Connected. Auto movement is running.');
      this.scheduleAutoMove();
    } catch (error) {
      const message = errorMessage(error);
      this.statusText.setText(`Unable to join: ${message}`);
      showToast(`Unable to join movement demo: ${message}`);
    }
  }

  async requestMove(to: BallPoint) {
    this.localMoving = true;
    this.statusText.setText('Moving...');
    try {
      const message = await trpc.realtime.moveBall.mutate({
        clientId: this.clientId,
        to,
      });
      this.applyMove(message);
    } catch (error) {
      const message = errorMessage(error);
      this.localMoving = false;
      this.statusText.setText(`Move failed: ${message}`);
      showToast(`Move failed: ${message}`);
      this.scheduleAutoMove();
    }
  }

  applyMove(message: RealtimeBallMoveMessage) {
    const isLocal = message.clientId === this.clientId;
    let ball = this.balls.get(message.clientId);
    if (!ball) {
      ball = this.createBall(message);
      this.balls.set(message.clientId, ball);
    }

    if (message.seq <= ball.lastSeq) return;

    ball.lastSeq = message.seq;
    ball.lastSeenAt = Date.now();
    ball.label.setText(message.username);
    ball.tween?.stop();

    const setPosition = (x: number, y: number) => {
      ball.dot.setPosition(x, y);
      ball.ring.setPosition(x, y);
      ball.label.setPosition(x, y + BALL_RADIUS + 10);
    };

    setPosition(message.from.x, message.from.y);

    if (message.durationMs === 0) {
      setPosition(message.to.x, message.to.y);
      return;
    }

    ball.tween = this.tweens.add({
      targets: ball.dot,
      x: message.to.x,
      y: message.to.y,
      duration: message.durationMs,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        setPosition(ball.dot.x, ball.dot.y);
      },
      onComplete: () => {
        setPosition(message.to.x, message.to.y);
        ball.tween = undefined;
        if (isLocal) {
          this.localMoving = false;
          this.statusText.setText('Connected. Auto movement is running.');
          this.scheduleAutoMove();
        }
      },
    });
  }

  createBall(message: RealtimeBallMoveMessage): BallView {
    const isLocal = message.clientId === this.clientId;
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
      .text(message.from.x, message.from.y + BALL_RADIUS + 10, message.username, {
        fontFamily: 'Arial',
        fontSize: 14,
        color: isLocal ? '#ffffff' : '#cbd5e1',
      })
      .setOrigin(0.5, 0);

    return {
      dot,
      ring,
      label,
      lastSeq: -1,
      lastSeenAt: Date.now(),
      tween: undefined,
    };
  }

  scheduleAutoMove() {
    this.autoMoveTimer?.remove(false);
    this.autoMoveTimer = this.time.delayedCall(AUTO_MOVE_DELAY_MS, () => {
      if (!this.joined || this.localMoving) return;
      void this.requestMove(randomPoint());
    });
  }

  cleanup() {
    this.unsubscribeRealtime?.();
    this.autoMoveTimer?.remove(false);
    this.balls.clear();
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  backgroundColor: '#101624',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: BALL_WORLD_WIDTH,
    height: BALL_WORLD_HEIGHT,
  },
  scene: [SmoothMovementScene],
};

let currentGame: Game | undefined;

export const startSmoothMovementDemo = (parentId: string): Game => {
  currentGame?.destroy(true);
  currentGame = new Game({ ...config, parent: parentId });
  return currentGame;
};

export const stopSmoothMovementDemo = (): void => {
  currentGame?.destroy(true);
  currentGame = undefined;
};
