import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { context } from '@devvit/web/client';
import { trpc } from '../trpc';
import { onCursorMessage } from '../realtimeChannel';

export class Game extends Scene {
  camera: Phaser.Cameras.Scene2D.Camera;
  background: Phaser.GameObjects.Image;
  msg_text: Phaser.GameObjects.Text;
  count: number = 0;
  countText: Phaser.GameObjects.Text;
  incButton: Phaser.GameObjects.Text;
  decButton: Phaser.GameObjects.Text;
  goButton: Phaser.GameObjects.Text;

  // Multiplayer cursor sync (Realtime demo): one dot + label per remote user seen
  // on this post's realtime channel, keyed by userId.
  remoteCursors = new Map<
    string,
    { dot: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text }
  >();
  lastCursorBroadcastAt = 0;

  constructor() {
    super('Game');
  }

  create() {
    // Configure camera & background
    this.camera = this.cameras.main;
    this.camera.setBackgroundColor(0x222222);

    // Optional: semi-transparent background image if one has been loaded elsewhere
    this.background = this.add.image(512, 384, 'background').setAlpha(0.25);

    /* -------------------------------------------
     *  UI Elements
     * ------------------------------------------- */

    // Display the current count
    this.countText = this.add
      .text(512, 340, `Count: ${this.count}`, {
        fontFamily: 'Arial Black',
        fontSize: 56,
        color: '#ffd700',
        stroke: '#000000',
        strokeThickness: 10,
      })
      .setOrigin(0.5);

    // Fetch the initial counter value from the server (via tRPC, backed by Redis)
    // and update the UI.
    void (async () => {
      try {
        const { count } = await trpc.redis.counter.get.query();
        this.count = count;
        this.updateCountText();
      } catch (error) {
        console.error('Failed to fetch initial count:', error);
      }
    })();

    // Button styling helper
    const createButton = (
      y: number,
      label: string,
      color: string,
      onClick: () => void
    ) => {
      const button = this.add
        .text(512, y, label, {
          fontFamily: 'Arial Black',
          fontSize: 36,
          color: color,
          backgroundColor: '#444444',
          padding: {
            x: 25,
            y: 12,
          } as Phaser.Types.GameObjects.Text.TextPadding,
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () =>
          button.setStyle({ backgroundColor: '#555555' })
        )
        .on('pointerout', () => button.setStyle({ backgroundColor: '#444444' }))
        .on('pointerdown', onClick);
      return button;
    };

    // Increment button
    this.incButton = createButton(
      this.scale.height * 0.55,
      'Increment',
      '#00ff00',
      async () => {
        try {
          const { count } = await trpc.redis.counter.increment.mutate();
          this.count = count;
          this.updateCountText();
        } catch (error) {
          console.error('Failed to increment count:', error);
        }
      }
    );

    // Decrement button
    this.decButton = createButton(
      this.scale.height * 0.65,
      'Decrement',
      '#ff5555',
      async () => {
        try {
          const { count } = await trpc.redis.counter.decrement.mutate();
          this.count = count;
          this.updateCountText();
        } catch (error) {
          console.error('Failed to decrement count:', error);
        }
      }
    );

    // Game Over button – navigates to the GameOver scene
    this.goButton = createButton(
      this.scale.height * 0.75,
      'Game Over',
      '#ffffff',
      () => {
        this.scene.start('GameOver');
      }
    );

    // Setup responsive layout
    this.updateLayout(this.scale.width, this.scale.height);
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      const { width, height } = gameSize;
      this.updateLayout(width, height);
    });

    this.setupRealtimeCursorSync();

    // No automatic navigation to GameOver – users can stay in this scene.
  }

  /** Realtime demo: broadcast this player's pointer position (throttled) and render
   * every other connected player's last-known position as a labeled dot. */
  setupRealtimeCursorSync() {
    const unsubscribe = onCursorMessage((msg) => {
      if (msg.userId === context.userId) return; // ignore our own broadcasts

      let cursor = this.remoteCursors.get(msg.userId);
      if (!cursor) {
        const dot = this.add.circle(msg.x, msg.y, 10, 0x00ffff);
        const label = this.add.text(msg.x + 12, msg.y - 8, msg.username, {
          fontFamily: 'Arial',
          fontSize: 16,
          color: '#00ffff',
        });
        cursor = { dot, label };
        this.remoteCursors.set(msg.userId, cursor);
      }
      cursor.dot.setPosition(msg.x, msg.y);
      cursor.label.setPosition(msg.x + 12, msg.y - 8);
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const now = Date.now();
      if (now - this.lastCursorBroadcastAt < 100) return; // throttle to ~10/sec
      this.lastCursorBroadcastAt = now;
      trpc.realtime.broadcastCursor
        .mutate({
          x: Math.round(pointer.worldX),
          y: Math.round(pointer.worldY),
        })
        .catch((error: unknown) =>
          console.error('Failed to broadcast cursor:', error)
        );
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const { dot, label } of this.remoteCursors.values()) {
        dot.destroy();
        label.destroy();
      }
      this.remoteCursors.clear();
      unsubscribe();
    });
  }

  updateLayout(width: number, height: number) {
    // Resize camera viewport to avoid black bars
    this.cameras.resize(width, height);

    // Center and scale background image to cover screen
    if (this.background) {
      this.background.setPosition(width / 2, height / 2);
      if (this.background.width && this.background.height) {
        const scale = Math.max(
          width / this.background.width,
          height / this.background.height
        );
        this.background.setScale(scale);
      }
    }

    // Calculate a scale factor relative to a 1024 × 768 reference resolution.
    // We only shrink on smaller screens – never enlarge above 1×.
    const scaleFactor = Math.min(Math.min(width / 1024, height / 768), 1);

    if (this.countText) {
      this.countText.setPosition(width / 2, height * 0.45);
      this.countText.setScale(scaleFactor);
    }

    if (this.incButton) {
      this.incButton.setPosition(width / 2, height * 0.55);
      this.incButton.setScale(scaleFactor);
    }

    if (this.decButton) {
      this.decButton.setPosition(width / 2, height * 0.65);
      this.decButton.setScale(scaleFactor);
    }

    if (this.goButton) {
      this.goButton.setPosition(width / 2, height * 0.75);
      this.goButton.setScale(scaleFactor);
    }
  }

  updateCountText() {
    this.countText.setText(`Count: ${this.count}`);
  }
}
