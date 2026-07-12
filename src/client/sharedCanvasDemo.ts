import { showToast } from '@devvit/web/client';
import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { onCanvasMessage } from './realtimeChannel';
import { traceClientLog } from './clientLogs';
import { trpc } from './trpc';
import {
  CANVAS_CELL_SIZE,
  CANVAS_COLORS,
  CANVAS_GRID_COLS,
  CANVAS_GRID_ROWS,
  CANVAS_WORLD_HEIGHT,
  CANVAS_WORLD_WIDTH,
  type CanvasItem,
  type RealtimeCanvasMessage,
} from '../shared/realtime';

export type SharedCanvasTool = 'pixel' | 'text' | 'erase';

export type SharedCanvasControls = {
  getTool: () => SharedCanvasTool;
  getColor: () => string;
  getEraserRadius: () => number;
  getText: () => string;
  clearText: () => void;
  setStatus: (text: string) => void;
};

type CanvasView = {
  object: Phaser.GameObjects.GameObject;
  item: CanvasItem;
};

type PendingTextRequest = {
  x: number;
  y: number;
  text: string;
  color: string;
  requestId: string;
};

type PixelRequest = {
  col: number;
  row: number;
  color: string;
};

const colorNumber = (color: string) => {
  const parsed = Number.parseInt(color.slice(1), 16);
  return Number.isFinite(parsed) ? parsed : 0x38bdf8;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const defaultControls: SharedCanvasControls = {
  getTool: () => 'pixel',
  getColor: () => CANVAS_COLORS[5] ?? '#38bdf8',
  getEraserRadius: () => 32,
  getText: () => '',
  clearText: () => {},
  setStatus: () => {},
};

class SharedCanvasScene extends Phaser.Scene {
  controls: SharedCanvasControls;
  items = new Map<string, CanvasView>();
  paintedThisDrag = new Set<string>();
  unsubscribeRealtime: (() => void) | undefined;
  lastEraseAt = 0;
  active = false;
  canvasRevision = 0;
  pixelQueue: PixelRequest[] = [];
  pixelWriteInFlight = false;
  snapshotPromise: Promise<void> | undefined;
  snapshotRefreshRequested = false;
  textCommitInFlight = false;
  pendingTextRequest: PendingTextRequest | undefined;

  constructor(controls: SharedCanvasControls) {
    super('SharedCanvasScene');
    this.controls = controls;
  }

  create() {
    this.active = true;
    this.cameras.main.setBackgroundColor(0x0f1117);
    this.drawGrid();
    this.setStatus('Loading canvas...');

    this.unsubscribeRealtime = onCanvasMessage((message) => {
      if (this.active) this.applyRealtime(message);
    });

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.active) return;
      this.paintedThisDrag.clear();
      this.handlePointer(pointer, true);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.active && pointer.isDown) this.handlePointer(pointer, false);
    });
    this.input.on('pointerup', () => this.paintedThisDrag.clear());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('focus', this.handleFocus);
    window.addEventListener('pageshow', this.handlePageShow);

    void this.loadSnapshot();
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

  drawGrid() {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x111827, 1);
    graphics.fillRect(0, 0, CANVAS_WORLD_WIDTH, CANVAS_WORLD_HEIGHT);
    graphics.lineStyle(1, 0x263244, 0.35);
    for (let col = 0; col <= CANVAS_GRID_COLS; col += 1) {
      const x = col * CANVAS_CELL_SIZE;
      graphics.lineBetween(x, 0, x, CANVAS_WORLD_HEIGHT);
    }
    for (let row = 0; row <= CANVAS_GRID_ROWS; row += 1) {
      const y = row * CANVAS_CELL_SIZE;
      graphics.lineBetween(0, y, CANVAS_WORLD_WIDTH, y);
    }
  }

  setStatus(text: string) {
    if (this.active) this.controls.setStatus(text);
  }

  loadSnapshot(showStatus = true): Promise<void> {
    if (this.snapshotPromise) {
      this.snapshotRefreshRequested = true;
      return this.snapshotPromise;
    }
    const request = (async () => {
      try {
        const snapshot = await trpc.realtime.canvas.snapshot.query();
        if (!this.active) return;

        this.applySnapshot(snapshot.items, snapshot.revision);
        if (showStatus) {
          this.setStatus(`Connected. ${snapshot.items.length} marks loaded.`);
          console.info('Loaded shared canvas snapshot:', snapshot.items.length);
        }
      } catch (error) {
        if (!this.active) return;

        const message = errorMessage(error);
        this.setStatus(`Canvas load failed: ${message}`);
        console.error('Failed to load shared canvas:', error);
        showToast(`Canvas load failed: ${message}`);
      }
    })().finally(() => {
      if (this.snapshotPromise === request) {
        this.snapshotPromise = undefined;
        if (this.active && this.snapshotRefreshRequested) {
          this.snapshotRefreshRequested = false;
          void this.loadSnapshot(false);
        }
      }
    });
    this.snapshotPromise = request;
    return request;
  }

  applySnapshot(items: CanvasItem[], revision: number) {
    if (!this.active || revision < this.canvasRevision) return;

    const ids = new Set(items.map((item) => item.id));
    for (const [id, view] of this.items) {
      if (!ids.has(id)) {
        view.object.destroy();
        this.items.delete(id);
      }
    }
    for (const item of items) this.renderPut(item);
    this.canvasRevision = revision;
  }

  handlePointer(pointer: Phaser.Input.Pointer, freshClick: boolean) {
    const x = clamp(pointer.worldX, 0, CANVAS_WORLD_WIDTH);
    const y = clamp(pointer.worldY, 0, CANVAS_WORLD_HEIGHT);
    const tool = this.controls.getTool();

    if (tool === 'text') {
      if (freshClick) void this.shareText(x, y);
      return;
    }

    if (tool === 'pixel') {
      this.paintPixel(x, y);
    } else {
      this.eraseAt(x, y);
    }
  }

  paintPixel(x: number, y: number) {
    if (!this.active) return;

    const col = clamp(
      Math.floor(x / CANVAS_CELL_SIZE),
      0,
      CANVAS_GRID_COLS - 1
    );
    const row = clamp(
      Math.floor(y / CANVAS_CELL_SIZE),
      0,
      CANVAS_GRID_ROWS - 1
    );
    const key = `${col}:${row}`;
    if (this.paintedThisDrag.has(key)) return;
    this.paintedThisDrag.add(key);
    this.pixelQueue.push({ col, row, color: this.controls.getColor() });
    void this.flushPixelQueue();
  }

  async flushPixelQueue() {
    if (!this.active || this.pixelWriteInFlight) return;
    const request = this.pixelQueue.shift();
    if (!request) return;

    this.pixelWriteInFlight = true;
    try {
      const { item } = await trpc.realtime.canvas.putPixel.mutate(request);
      if (!this.active) return;

      this.applyPut(item, item.revision);
      this.setStatus('Pixel shared.');
    } catch (error) {
      if (!this.active) return;

      const message = errorMessage(error);
      this.setStatus(`Pixel failed: ${message}`);
      console.error('Failed to share canvas pixel:', error);
      showToast(`Pixel failed: ${message}`);
    } finally {
      this.pixelWriteInFlight = false;
      if (this.active) void this.flushPixelQueue();
    }
  }

  eraseAt(x: number, y: number) {
    if (!this.active) return;

    const now = Date.now();
    if (now - this.lastEraseAt < 75) return;
    this.lastEraseAt = now;

    void (async () => {
      try {
        const { ids, revision } = await trpc.realtime.canvas.eraseAt.mutate({
          x: Math.round(x),
          y: Math.round(y),
          radius: this.controls.getEraserRadius(),
        });
        if (!this.active) return;

        this.applyErase(ids, revision);
        this.setStatus(
          ids.length ? `Erased ${ids.length} mark(s).` : 'Nothing to erase.'
        );
      } catch (error) {
        if (!this.active) return;

        const message = errorMessage(error);
        this.setStatus(`Erase failed: ${message}`);
        console.error('Failed to erase shared canvas marks:', error);
        showToast(`Erase failed: ${message}`);
      }
    })();
  }

  async shareText(x: number, y: number) {
    if (this.textCommitInFlight) return;
    const text = this.controls.getText().trim();
    if (!text) {
      this.setStatus('Enter text in the toolbar, then tap the canvas.');
      return;
    }

    const request =
      this.pendingTextRequest?.text === text
        ? this.pendingTextRequest
        : {
            x: Math.round(x),
            y: Math.round(y),
            text,
            color: this.controls.getColor(),
            requestId: crypto.randomUUID(),
          };
    this.pendingTextRequest = request;
    this.textCommitInFlight = true;
    try {
      const { item } = await trpc.realtime.canvas.putText.mutate({
        ...request,
      });
      if (!this.active) return;

      this.applyPut(item, item.revision);
      if (this.pendingTextRequest === request)
        this.pendingTextRequest = undefined;
      this.controls.clearText();
      this.setStatus('Text shared.');
    } catch (error) {
      if (!this.active) return;

      const message = errorMessage(error);
      this.setStatus(`Text failed: ${message}`);
      console.error('Failed to share canvas text:', error);
      showToast(`Text failed: ${message}`);
    } finally {
      this.textCommitInFlight = false;
    }
  }

  applyRealtime(message: RealtimeCanvasMessage) {
    if (!this.active) return;

    if (message.type === 'canvasPut') {
      this.applyPut(message.item, message.item.revision);
    } else {
      this.applyErase(message.ids, message.revision);
    }
  }

  applyPut(item: CanvasItem, revision: number) {
    if (!this.active || revision <= this.canvasRevision) return;
    const missedRevision = revision > this.canvasRevision + 1;
    this.renderPut(item);
    this.canvasRevision = revision;
    if (missedRevision) void this.loadSnapshot(false);
  }

  renderPut(item: CanvasItem) {
    if (!this.active) return;

    const current = this.items.get(item.id);
    if (current && current.item.revision >= item.revision) return;
    current?.object.destroy();

    if (item.kind === 'pixel') {
      const object = this.add
        .rectangle(
          item.col * CANVAS_CELL_SIZE,
          item.row * CANVAS_CELL_SIZE,
          CANVAS_CELL_SIZE,
          CANVAS_CELL_SIZE,
          colorNumber(item.color),
          1
        )
        .setOrigin(0)
        .setDepth(2);
      this.items.set(item.id, { object, item });
      return;
    }

    const object = this.add
      .text(item.x, item.y, item.text, {
        fontFamily: 'Arial Black',
        fontSize: 24,
        color: item.color,
        stroke: '#020617',
        strokeThickness: 4,
      })
      .setOrigin(0, 0.5)
      .setDepth(2);
    this.items.set(item.id, { object, item });
  }

  applyErase(ids: string[], revision: number) {
    if (!this.active || revision <= this.canvasRevision) return;
    const missedRevision = revision > this.canvasRevision + 1;

    for (const id of ids) {
      this.items.get(id)?.object.destroy();
      this.items.delete(id);
    }
    this.canvasRevision = revision;
    if (missedRevision) void this.loadSnapshot(false);
  }

  cleanup() {
    this.active = false;
    this.unsubscribeRealtime?.();
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange
    );
    window.removeEventListener('focus', this.handleFocus);
    window.removeEventListener('pageshow', this.handlePageShow);
    this.pixelQueue = [];
    for (const { object } of this.items.values()) {
      object.destroy();
    }
    this.items.clear();
  }
}

const config = (
  controls: SharedCanvasControls
): Phaser.Types.Core.GameConfig => ({
  type: AUTO,
  audio: { noAudio: true },
  backgroundColor: '#0f1117',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: CANVAS_WORLD_WIDTH,
    height: CANVAS_WORLD_HEIGHT,
  },
  scene: [new SharedCanvasScene(controls)],
});

let currentGame: Game | undefined;

export const startSharedCanvasDemo = (
  parentId: string,
  controls: SharedCanvasControls = defaultControls
): Game => {
  traceClientLog('Starting shared canvas demo:', parentId);
  currentGame?.destroy(true);
  currentGame = new Game({ ...config(controls), parent: parentId });
  console.info('Started shared canvas demo:', parentId);
  return currentGame;
};

export const stopSharedCanvasDemo = (): void => {
  if (currentGame) traceClientLog('Stopping shared canvas demo.');
  currentGame?.destroy(true);
  currentGame = undefined;
};
