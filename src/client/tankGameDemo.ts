import { showToast } from '@devvit/web/client';
import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import {
  TANK_END_TURN_DURATION_MS,
  TANK_PROJECTILE_RADIUS,
  TANK_RADIUS,
  TANK_SNAPSHOT_INTERVAL_MS,
  TANK_STARTING_HEALTH,
  TANK_WORLD_HEIGHT,
  TANK_WORLD_WIDTH,
  type TankActionKind,
  type TankActionRejectionReason,
  type TankGameState,
  type TankPlayerState,
  type TankPoint,
} from '../shared/tankGame';
import { traceClientLog } from './clientLogs';
import {
  onTankGameConnectionChange,
  onTankGameMessage,
} from './realtimeChannel';
import { trpc } from './trpc';

type TankView = {
  sprite: Phaser.GameObjects.Sprite;
  ring: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  health: Phaser.GameObjects.Text;
};

export type TankGameViewModel = {
  state: TankGameState | undefined;
  selfPlayerId: string | null;
  selectedAction: TankActionKind | undefined;
  pending: boolean;
  canAct: boolean;
  canJoin: boolean;
  canRematch: boolean;
  status: string;
  prompt: string;
};

export type TankGameControls = {
  renderView: (view: TankGameViewModel) => void;
};

const defaultControls: TankGameControls = {
  renderView: () => {},
};

const colorNumber = (color: string) => {
  const parsed = Number.parseInt(color.slice(1), 16);
  return Number.isFinite(parsed) ? parsed : 0x38bdf8;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const rejectionMessage = (reason: TankActionRejectionReason): string => {
  if (reason === 'path-blocked')
    return 'Move rejected: another tank blocks that path.';
  if (reason === 'not-your-turn')
    return 'Action rejected: it is not your turn.';
  if (reason === 'action-resolving')
    return 'Action rejected: the previous turn is still resolving.';
  if (reason === 'invalid-target')
    return 'Action rejected: choose another target.';
  if (reason === 'not-player')
    return 'Action rejected: you are spectating this match.';
  return 'Action rejected: no match is currently running.';
};

class TankGameScene extends Phaser.Scene {
  controls: TankGameControls;
  state: TankGameState | undefined;
  selfPlayerId: string | null = null;
  selectedAction: TankActionKind | undefined;
  pending = false;
  active = false;
  serverOffsetMs = 0;
  tankViews = new Map<string, TankView>();
  projectile: Phaser.GameObjects.Arc | undefined;
  endTurnText!: Phaser.GameObjects.Text;
  snapshotTimer: Phaser.Time.TimerEvent | undefined;
  viewTimer: Phaser.Time.TimerEvent | undefined;
  unsubscribeRealtime: (() => void) | undefined;
  unsubscribeConnection: (() => void) | undefined;
  lastViewKey = '';
  feedback = '';

  constructor(controls: TankGameControls) {
    super('TankGameScene');
    this.controls = controls;
  }

  create() {
    this.active = true;
    registerCurrentScene(this);
    this.cameras.main.setBackgroundColor(0x111827);
    this.drawArena();
    this.createTankTexture();

    this.endTurnText = this.add
      .text(TANK_WORLD_WIDTH / 2, TANK_WORLD_HEIGHT / 2, 'End Turn', {
        fontFamily: 'Arial Black',
        fontSize: 54,
        color: '#ffffff',
        stroke: '#020617',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);

    this.unsubscribeRealtime = onTankGameMessage((message) => {
      if (this.active)
        this.applyState(message.state, undefined, message.sentAt);
    });
    this.unsubscribeConnection = onTankGameConnectionChange((connected) => {
      if (this.active && connected) void this.loadSnapshot(false);
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      void this.requestAction({
        x: Math.round(pointer.worldX),
        y: Math.round(pointer.worldY),
      });
    });
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('focus', this.handleFocus);
    window.addEventListener('pageshow', this.handlePageShow);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    this.snapshotTimer = this.time.addEvent({
      delay: TANK_SNAPSHOT_INTERVAL_MS,
      loop: true,
      callback: () => void this.loadSnapshot(false),
    });
    this.viewTimer = this.time.addEvent({
      delay: 200,
      loop: true,
      callback: () => this.publishView(),
    });

    this.publishView(true);
    void this.loadSnapshot();
  }

  override update() {
    if (this.active) this.renderTimeline();
  }

  serverNow() {
    return Date.now() - this.serverOffsetMs;
  }

  handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') void this.loadSnapshot(false);
  };

  handleFocus = () => {
    void this.loadSnapshot(false);
  };

  handlePageShow = () => {
    void this.loadSnapshot(false);
  };

  drawArena() {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x111827, 1);
    graphics.fillRect(0, 0, TANK_WORLD_WIDTH, TANK_WORLD_HEIGHT);
    graphics.lineStyle(1, 0x334155, 0.45);
    for (let x = 0; x <= TANK_WORLD_WIDTH; x += 64) {
      graphics.lineBetween(x, 0, x, TANK_WORLD_HEIGHT);
    }
    for (let y = 0; y <= TANK_WORLD_HEIGHT; y += 64) {
      graphics.lineBetween(0, y, TANK_WORLD_WIDTH, y);
    }
    graphics.lineStyle(3, 0x64748b, 0.8);
    graphics.strokeRoundedRect(
      32,
      32,
      TANK_WORLD_WIDTH - 64,
      TANK_WORLD_HEIGHT - 64,
      12
    );
  }

  createTankTexture() {
    if (this.textures.exists('tank-game-tank')) return;

    const graphics = this.add.graphics();
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRoundedRect(8, 8, 38, 30, 7);
    graphics.fillRoundedRect(1, 5, 10, 36, 4);
    graphics.fillRoundedRect(43, 5, 10, 36, 4);
    graphics.fillCircle(27, 23, 10);
    graphics.fillRoundedRect(27, 19, 31, 8, 4);
    graphics.generateTexture('tank-game-tank', 62, 46);
    graphics.destroy();
  }

  async loadSnapshot(showErrors = true) {
    try {
      const snapshot = await trpc.tankGame.snapshot.query();
      if (!this.active) return;
      this.applyState(
        snapshot.state,
        snapshot.selfPlayerId,
        snapshot.serverNow
      );
    } catch (error) {
      if (!this.active) return;
      const message = errorMessage(error);
      console.error('Failed to load tank game snapshot:', error);
      if (showErrors) showToast(`Tank game load failed: ${message}`);
    }
  }

  applyState(
    state: TankGameState,
    selfPlayerId: string | null | undefined,
    serverNow: number
  ) {
    if (!this.active) return;

    this.serverOffsetMs = Date.now() - serverNow;
    const previousSelfPlayerId = this.selfPlayerId;
    if (selfPlayerId !== undefined) this.selfPlayerId = selfPlayerId;
    if (this.state && state.version < this.state.version) {
      this.publishView();
      return;
    }

    const isNewVersion = !this.state || state.version > this.state.version;
    this.state = state;
    if (isNewVersion) {
      if (state.lastAction?.actorId === this.selfPlayerId) {
        this.selectedAction = undefined;
      }
      this.feedback = '';
      traceClientLog('Applied tank game state:', state.version, state.phase);
    }
    if (isNewVersion || previousSelfPlayerId !== this.selfPlayerId) {
      this.syncPlayers();
    }
    this.renderTimeline();
    this.publishView(true);
  }

  syncPlayers() {
    const state = this.state;
    if (!state) return;

    const playerIds = new Set(state.players.map((player) => player.playerId));
    for (const [playerId, view] of this.tankViews) {
      if (playerIds.has(playerId)) continue;
      view.sprite.destroy();
      view.ring.destroy();
      view.label.destroy();
      view.health.destroy();
      this.tankViews.delete(playerId);
    }

    for (const player of state.players) {
      let view = this.tankViews.get(player.playerId);
      if (!view) {
        view = this.createTankView(player);
        this.tankViews.set(player.playerId, view);
      }
      view.sprite.setTint(colorNumber(player.color));
      view.sprite.setAlpha(player.health > 0 ? 1 : 0.3);
      view.ring.setVisible(player.playerId === this.selfPlayerId);
      view.label.setText(player.username);
      view.health.setText(
        player.health > 0
          ? `HP ${player.health}/${TANK_STARTING_HEALTH}`
          : 'ELIMINATED'
      );
      view.health.setColor(player.health > 0 ? '#f8fafc' : '#f87171');
      this.setTankPosition(view, player.position);
      view.sprite.setRotation(player.facing);
    }
  }

  createTankView(player: TankPlayerState): TankView {
    const sprite = this.add
      .sprite(player.position.x, player.position.y, 'tank-game-tank')
      .setOrigin(0.44, 0.5)
      .setDepth(5);
    const ring = this.add
      .circle(player.position.x, player.position.y, TANK_RADIUS + 8)
      .setStrokeStyle(3, 0xffffff, 0.95)
      .setDepth(4);
    const label = this.add
      .text(player.position.x, player.position.y + 38, player.username, {
        fontFamily: 'Arial',
        fontSize: 15,
        color: '#f8fafc',
        stroke: '#020617',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setDepth(6);
    const health = this.add
      .text(player.position.x, player.position.y - 50, '', {
        fontFamily: 'Arial Black',
        fontSize: 14,
        color: '#f8fafc',
        stroke: '#020617',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(6);
    return { sprite, ring, label, health };
  }

  setTankPosition(view: TankView, point: TankPoint) {
    view.sprite.setPosition(point.x, point.y);
    view.ring.setPosition(point.x, point.y);
    view.label.setPosition(point.x, point.y + 38);
    view.health.setPosition(point.x, point.y - 34);
  }

  renderTimeline() {
    const state = this.state;
    const action = state?.lastAction;
    if (!state || !action) {
      this.projectile?.destroy();
      this.projectile = undefined;
      this.endTurnText?.setVisible(false);
      return;
    }

    const actorView = this.tankViews.get(action.actorId);
    const actor = state.players.find(
      (player) => player.playerId === action.actorId
    );
    if (!actorView || !actor) return;

    const now = this.serverNow();
    const rotateEndsAt = action.startedAt + action.rotateDurationMs;
    const travelEndsAt = rotateEndsAt + action.travelDurationMs;
    const angleDelta = Phaser.Math.Angle.Wrap(
      action.facing - action.fromFacing
    );

    if (now < rotateEndsAt) {
      const progress = clamp01(
        (now - action.startedAt) / Math.max(1, action.rotateDurationMs)
      );
      this.setTankPosition(actorView, action.from);
      actorView.sprite.setRotation(action.fromFacing + angleDelta * progress);
      this.hideProjectile();
    } else if (now < travelEndsAt) {
      const progress = clamp01(
        (now - rotateEndsAt) / Math.max(1, action.travelDurationMs)
      );
      actorView.sprite.setRotation(action.facing);
      if (action.kind === 'move') {
        this.setTankPosition(actorView, {
          x: Phaser.Math.Linear(action.from.x, action.end.x, progress),
          y: Phaser.Math.Linear(action.from.y, action.end.y, progress),
        });
        this.hideProjectile();
      } else {
        this.setTankPosition(actorView, actor.position);
        if (!this.projectile) {
          this.projectile = this.add
            .circle(
              action.from.x,
              action.from.y,
              TANK_PROJECTILE_RADIUS,
              0xef4444
            )
            .setDepth(10);
        }
        this.projectile.setPosition(
          Phaser.Math.Linear(action.from.x, action.end.x, progress),
          Phaser.Math.Linear(action.from.y, action.end.y, progress)
        );
      }
    } else {
      this.setTankPosition(actorView, actor.position);
      actorView.sprite.setRotation(action.facing);
      this.hideProjectile();
    }

    const showEndTurn = now >= travelEndsAt && now < state.turnReadyAt;
    this.endTurnText.setVisible(showEndTurn);
    if (showEndTurn) {
      const progress = clamp01(
        (now - travelEndsAt) / Math.max(1, TANK_END_TURN_DURATION_MS)
      );
      this.endTurnText.setAlpha(1 - progress);
    }
  }

  hideProjectile() {
    this.projectile?.destroy();
    this.projectile = undefined;
  }

  chooseAction(action: TankActionKind) {
    if (!this.canAct()) return;
    this.selectedAction = action;
    this.feedback = '';
    this.publishView(true);
  }

  canAct() {
    const state = this.state;
    return Boolean(
      state &&
      !this.pending &&
      state.phase === 'playing' &&
      state.activePlayerId === this.selfPlayerId &&
      this.serverNow() >= state.turnReadyAt
    );
  }

  async requestAction(target: TankPoint) {
    if (!this.selectedAction || !this.canAct()) return;

    this.pending = true;
    this.feedback = 'Checking action with the server...';
    this.publishView(true);
    try {
      const result = await trpc.tankGame.act.mutate({
        action: this.selectedAction,
        target,
      });
      if (!this.active) return;

      if (result.accepted) {
        this.selectedAction = undefined;
        this.feedback = '';
        this.applyState(
          result.state,
          this.selfPlayerId ?? undefined,
          result.serverNow
        );
      } else {
        this.feedback = rejectionMessage(result.reason);
        this.applyState(
          result.state,
          this.selfPlayerId ?? undefined,
          result.serverNow
        );
        showToast(this.feedback);
      }
    } catch (error) {
      if (!this.active) return;
      const message = errorMessage(error);
      this.feedback = `Action failed: ${message}`;
      console.error('Tank action request failed:', error);
      showToast(this.feedback);
    } finally {
      if (this.active) {
        this.pending = false;
        this.publishView(true);
      }
    }
  }

  async join() {
    if (this.pending) return;
    this.pending = true;
    this.feedback = 'Joining...';
    this.publishView(true);
    try {
      const result = await trpc.tankGame.join.mutate();
      if (!this.active) return;
      this.feedback = result.joined ? '' : 'This match is already in progress.';
      this.applyState(
        result.state,
        result.selfPlayerId ?? undefined,
        result.serverNow
      );
      if (!result.joined) showToast(this.feedback);
    } catch (error) {
      if (!this.active) return;
      const message = errorMessage(error);
      this.feedback = `Unable to join: ${message}`;
      console.error('Failed to join tank game:', error);
      showToast(this.feedback);
    } finally {
      if (this.active) {
        this.pending = false;
        this.publishView(true);
      }
    }
  }

  async rematch() {
    if (this.pending) return;
    this.pending = true;
    this.feedback = 'Starting rematch...';
    this.publishView(true);
    try {
      const result = await trpc.tankGame.rematch.mutate();
      if (!this.active) return;
      this.feedback = result.accepted ? '' : 'Rematch is not available yet.';
      this.applyState(
        result.state,
        result.selfPlayerId ?? undefined,
        result.serverNow
      );
      if (!result.accepted) showToast(this.feedback);
    } catch (error) {
      if (!this.active) return;
      const message = errorMessage(error);
      this.feedback = `Rematch failed: ${message}`;
      console.error('Failed to start tank rematch:', error);
      showToast(this.feedback);
    } finally {
      if (this.active) {
        this.pending = false;
        this.publishView(true);
      }
    }
  }

  publishView(force = false) {
    const state = this.state;
    const now = this.serverNow();
    const self = state?.players.find(
      (player) => player.playerId === this.selfPlayerId
    );
    const active = state?.players.find(
      (player) => player.playerId === state.activePlayerId
    );
    const lastActor = state?.players.find(
      (player) => player.playerId === state.lastAction?.actorId
    );
    const winner = state?.players.find(
      (player) => player.playerId === state.winnerPlayerId
    );
    const resolving = Boolean(state?.lastAction && now < state.turnReadyAt);
    const canAct = this.canAct();
    const canJoin = Boolean(
      state &&
      this.selfPlayerId &&
      !self &&
      state.phase === 'lobby' &&
      state.players.length < 2 &&
      !this.pending
    );
    const canRematch = Boolean(
      state &&
      self &&
      state.phase === 'finished' &&
      now >= state.turnReadyAt &&
      !this.pending
    );

    let status = 'Loading authoritative game state...';
    if (state?.phase === 'lobby') {
      status = state.players.length
        ? `${state.players[0]?.username ?? 'A player'} joined. Waiting for one more player.`
        : 'Lobby open. Two players are needed.';
    } else if (state?.phase === 'playing') {
      const turnPlayer = resolving ? lastActor : active;
      status = `${turnPlayer?.username ?? 'A player'} is taking their turn.`;
    } else if (state?.phase === 'finished') {
      status = resolving
        ? `${lastActor?.username ?? 'A player'} is taking their turn.`
        : `${winner?.username ?? 'A player'} wins!`;
    }

    let prompt = this.feedback;
    if (!prompt && state) {
      if (!self)
        prompt =
          state.phase === 'lobby'
            ? 'Click Join to play.'
            : 'Spectating this match.';
      else if (state.phase === 'lobby')
        prompt = 'Waiting for another player to join.';
      else if (state.phase === 'finished') prompt = 'The match is complete.';
      else if (resolving) prompt = 'The current action is resolving.';
      else if (!canAct)
        prompt = `Wait for ${active?.username ?? 'the active player'}.`;
      else if (this.selectedAction)
        prompt = `Tap the arena to ${this.selectedAction}.`;
      else prompt = 'Choose Move or Fire.';
    }

    const view: TankGameViewModel = {
      state,
      selfPlayerId: this.selfPlayerId,
      selectedAction: this.selectedAction,
      pending: this.pending,
      canAct,
      canJoin,
      canRematch,
      status,
      prompt,
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
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange
    );
    window.removeEventListener('focus', this.handleFocus);
    window.removeEventListener('pageshow', this.handlePageShow);
    this.snapshotTimer?.remove(false);
    this.viewTimer?.remove(false);
    this.hideProjectile();
    for (const view of this.tankViews.values()) {
      view.sprite.destroy();
      view.ring.destroy();
      view.label.destroy();
      view.health.destroy();
    }
    this.tankViews.clear();
  }
}

const config = (controls: TankGameControls): Phaser.Types.Core.GameConfig => ({
  type: AUTO,
  backgroundColor: '#111827',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: TANK_WORLD_WIDTH,
    height: TANK_WORLD_HEIGHT,
  },
  scene: [new TankGameScene(controls)],
});

let currentGame: Game | undefined;
let currentScene: TankGameScene | undefined;

const registerCurrentScene = (scene: TankGameScene): void => {
  currentScene = scene;
};

export const startTankGameDemo = (
  parentId: string,
  controls: TankGameControls = defaultControls
): Game => {
  traceClientLog('Starting tank game demo:', parentId);
  currentGame?.destroy(true);
  currentGame = new Game({ ...config(controls), parent: parentId });
  return currentGame;
};

export const stopTankGameDemo = (): void => {
  if (currentGame) traceClientLog('Stopping tank game demo.');
  currentGame?.destroy(true);
  currentGame = undefined;
  currentScene = undefined;
};

export const chooseTankAction = (action: TankActionKind): void => {
  currentScene?.chooseAction(action);
};

export const joinTankGame = async (): Promise<void> => {
  await currentScene?.join();
};

export const rematchTankGame = async (): Promise<void> => {
  await currentScene?.rematch();
};
