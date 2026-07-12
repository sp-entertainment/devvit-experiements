import * as Phaser from 'phaser';
import { Game, WEBGL } from 'phaser';
import { traceClientLog } from './clientLogs';

const HALLWAY_WIDTH = 768;
const HALLWAY_HEIGHT = 1024;
const CORRIDOR_LEFT = 176;
const CORRIDOR_RIGHT = HALLWAY_WIDTH - CORRIDOR_LEFT;
const TORCH_TOP = 170;
const TORCH_BOTTOM = HALLWAY_HEIGHT - TORCH_TOP;

class LightingHallwayScene extends Phaser.Scene {
  constructor() {
    super('LightingHallwayScene');
  }

  preload() {
    this.load.image({
      key: 'lighting-hallway-floor',
      url: 'assets/lighting-hallway/stone-floor.png',
      normalMap: 'assets/lighting-hallway/stone-floor-normal.png',
    });
    this.load.image({
      key: 'lighting-hallway-rock-wall',
      url: 'assets/lighting-hallway/rock-wall.png',
      normalMap: 'assets/lighting-hallway/rock-wall-normal.png',
    });
  }

  create() {
    this.cameras.main.setBackgroundColor(0x06080d);
    this.lights.enable().setAmbientColor(0x111722);

    const floor = this.add
      .tileSprite(
        HALLWAY_WIDTH / 2,
        HALLWAY_HEIGHT / 2,
        HALLWAY_WIDTH,
        HALLWAY_HEIGHT,
        'lighting-hallway-floor'
      )
      .setTileScale(0.48)
      .setLighting(true)
      .setSelfShadow(true, 0.38, 0.24);

    floor.setDepth(0);
    this.addWalls();
    this.addTorch();
  }

  private addWalls() {
    const segments = [
      { y: 180, scale: 0.27, offset: -7 },
      { y: 530, scale: 0.29, offset: 5 },
      { y: 860, scale: 0.26, offset: -3 },
    ];

    for (const segment of segments) {
      this.addWallSegment(
        CORRIDOR_LEFT - 92 + segment.offset,
        segment.y,
        -90,
        segment.scale
      );
      this.addWallSegment(
        CORRIDOR_RIGHT + 92 - segment.offset,
        segment.y,
        90,
        segment.scale
      );
    }
  }

  private addWallSegment(x: number, y: number, angle: number, scale: number) {
    return this.add
      .image(x, y, 'lighting-hallway-rock-wall')
      .setAngle(angle)
      .setScale(scale)
      .setLighting(true)
      .setSelfShadow(true, 0.3, 0.18)
      .setDepth(2);
  }

  private addTorch() {
    const torchX = HALLWAY_WIDTH / 2;
    const torch = this.lights.addLight(
      torchX,
      TORCH_TOP,
      250,
      0xffb24c,
      2.2,
      92
    );
    const glow = this.add
      .circle(torchX, TORCH_TOP, 11, 0xffc86e, 0.95)
      .setDepth(5);
    const core = this.add.circle(torchX, TORCH_TOP, 4, 0xfff1bf, 1).setDepth(6);

    this.tweens.add({
      targets: [torch, glow, core],
      y: TORCH_BOTTOM,
      duration: 6_500,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });
    this.tweens.add({
      targets: [glow, core],
      scale: { from: 0.82, to: 1.14 },
      alpha: { from: 0.72, to: 1 },
      duration: 420,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: WEBGL,
  audio: { noAudio: true },
  backgroundColor: '#06080d',
  pixelArt: true,
  render: {
    selfShadow: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: HALLWAY_WIDTH,
    height: HALLWAY_HEIGHT,
  },
  scene: [LightingHallwayScene],
};

let currentGame: Game | undefined;

export const startLightingHallwayDemo = (parentId: string): Game => {
  traceClientLog('Starting Phaser lighting hallway demo:', parentId);
  currentGame?.destroy(true);
  currentGame = new Game({ ...config, parent: parentId });
  return currentGame;
};

export const stopLightingHallwayDemo = (): void => {
  if (currentGame) traceClientLog('Stopping Phaser lighting hallway demo.');
  currentGame?.destroy(true);
  currentGame = undefined;
};
