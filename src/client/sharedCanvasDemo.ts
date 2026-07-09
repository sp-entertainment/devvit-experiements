import { showToast } from '@devvit/web/client';
import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { onCanvasMessage } from './realtimeChannel';
import { trpc } from './trpc';
import {
  CANVAS_CELL_SIZE,
  CANVAS_COLORS,
  CANVAS_GRID_COLS,
  CANVAS_GRID_ROWS,
  CANVAS_MAX_TEXT_LENGTH,
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
  setStatus: (text: string) => void;
};

type CanvasView = {
  object: Phaser.GameObjects.GameObject;
  item: CanvasItem;
};

type DraftText = {
  object: Phaser.GameObjects.Text;
  x: number;
  y: number;
  color: string;
  value: string;
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
  setStatus: () => {},
};

class SharedCanvasScene extends Phaser.Scene {
  controls: SharedCanvasControls;
  items = new Map<string, CanvasView>();
  paintedThisDrag = new Set<string>();
  draft: DraftText | undefined;
  unsubscribeRealtime: (() => void) | undefined;
  lastEraseAt = 0;
  active = false;

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
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (this.active) this.handleKey(event);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
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

  async loadSnapshot(showStatus = true) {
    const requestedAt = Date.now();
    try {
      const snapshot = await trpc.realtime.canvas.snapshot.query();
      if (!this.active) return;

      this.applySnapshot(snapshot.items, requestedAt);
      if (showStatus)
        this.setStatus(`Connected. ${snapshot.items.length} marks loaded.`);
    } catch (error) {
      if (!this.active) return;

      const message = errorMessage(error);
      this.setStatus(`Canvas load failed: ${message}`);
      showToast(`Canvas load failed: ${message}`);
    }
  }

  applySnapshot(items: CanvasItem[], requestedAt: number) {
    if (!this.active) return;

    const ids = new Set(items.map((item) => item.id));
    for (const [id, view] of this.items) {
      if (!ids.has(id) && view.item.updatedAt <= requestedAt) this.applyErase([id]);
    }
    for (const item of items) this.applyPut(item);
  }

  handlePointer(pointer: Phaser.Input.Pointer, freshClick: boolean) {
    const x = clamp(pointer.worldX, 0, CANVAS_WORLD_WIDTH);
    const y = clamp(pointer.worldY, 0, CANVAS_WORLD_HEIGHT);
    const tool = this.controls.getTool();

    if (tool === 'text') {
      if (freshClick) this.startDraft(x, y);
      return;
    }

    this.cancelDraft();
    if (tool === 'pixel') {
      this.paintPixel(x, y);
    } else {
      this.eraseAt(x, y);
    }
  }

  paintPixel(x: number, y: number) {
    if (!this.active) return;

    const col = clamp(Math.floor(x / CANVAS_CELL_SIZE), 0, CANVAS_GRID_COLS - 1);
    const row = clamp(Math.floor(y / CANVAS_CELL_SIZE), 0, CANVAS_GRID_ROWS - 1);
    const key = `${col}:${row}`;
    if (this.paintedThisDrag.has(key)) return;
    this.paintedThisDrag.add(key);

    void (async () => {
      try {
        const { item } = await trpc.realtime.canvas.putPixel.mutate({
          col,
          row,
          color: this.controls.getColor(),
        });
        if (!this.active) return;

        this.applyPut(item);
        this.setStatus('Pixel shared.');
      } catch (error) {
        if (!this.active) return;

        const message = errorMessage(error);
        this.setStatus(`Pixel failed: ${message}`);
        showToast(`Pixel failed: ${message}`);
      }
    })();
  }

  eraseAt(x: number, y: number) {
    if (!this.active) return;

    const now = Date.now();
    if (now - this.lastEraseAt < 75) return;
    this.lastEraseAt = now;

    void (async () => {
      try {
        const { ids } = await trpc.realtime.canvas.eraseAt.mutate({
          x: Math.round(x),
          y: Math.round(y),
          radius: this.controls.getEraserRadius(),
        });
        if (!this.active) return;

        this.applyErase(ids);
        this.setStatus(
          ids.length ? `Erased ${ids.length} mark(s).` : 'Nothing to erase.'
        );
      } catch (error) {
        if (!this.active) return;

        const message = errorMessage(error);
        this.setStatus(`Erase failed: ${message}`);
        showToast(`Erase failed: ${message}`);
      }
    })();
  }

  startDraft(x: number, y: number) {
    if (!this.active) return;

    this.cancelDraft();
    const color = this.controls.getColor();
    const object = this.add
      .text(x, y, '|', {
        fontFamily: 'Arial Black',
        fontSize: 24,
        color,
        stroke: '#020617',
        strokeThickness: 4,
      })
      .setOrigin(0, 0.5)
      .setDepth(3);

    this.draft = { object, x, y, color, value: '' };
    this.setStatus('Type, then press Enter to share.');
  }

  handleKey(event: KeyboardEvent) {
    if (!this.draft) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelDraft();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void this.commitDraft();
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      this.draft.value = this.draft.value.slice(0, -1);
      this.refreshDraft();
    } else if (
      event.key.length === 1 &&
      this.draft.value.length < CANVAS_MAX_TEXT_LENGTH
    ) {
      event.preventDefault();
      this.draft.value += event.key;
      this.refreshDraft();
    }
  }

  refreshDraft() {
    if (!this.draft) return;
    this.draft.object.setText(`${this.draft.value}|`);
  }

  async commitDraft() {
    if (!this.draft) return;

    const draft = this.draft;
    const text = draft.value.trim();
    if (!text) {
      this.cancelDraft();
      return;
    }

    try {
      const { item } = await trpc.realtime.canvas.putText.mutate({
        x: Math.round(draft.x),
        y: Math.round(draft.y),
        text,
        color: draft.color,
      });
      if (!this.active) return;

      this.applyPut(item);
      this.setStatus('Text shared.');
    } catch (error) {
      if (!this.active) return;

      const message = errorMessage(error);
      this.setStatus(`Text failed: ${message}`);
      showToast(`Text failed: ${message}`);
    } finally {
      if (this.active) this.cancelDraft();
    }
  }

  cancelDraft() {
    this.draft?.object.destroy();
    this.draft = undefined;
  }

  applyRealtime(message: RealtimeCanvasMessage) {
    if (!this.active) return;

    if (message.type === 'canvasPut') {
      this.applyPut(message.item);
    } else {
      this.applyErase(message.ids);
    }
  }

  applyPut(item: CanvasItem) {
    if (!this.active) return;

    const current = this.items.get(item.id);
    if (current?.item.updatedAt === item.updatedAt) return;
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

  applyErase(ids: string[]) {
    if (!this.active) return;

    for (const id of ids) {
      this.items.get(id)?.object.destroy();
      this.items.delete(id);
    }
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
    this.cancelDraft();
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
  currentGame?.destroy(true);
  currentGame = new Game({ ...config(controls), parent: parentId });
  return currentGame;
};

export const stopSharedCanvasDemo = (): void => {
  currentGame?.destroy(true);
  currentGame = undefined;
};
