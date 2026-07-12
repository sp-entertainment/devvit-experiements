import { Boot } from './scenes/Boot';
import { GameOver } from './scenes/GameOver';
import { Game as MainGame } from './scenes/Game';
import { MainMenu } from './scenes/MainMenu';
import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { Preloader } from './scenes/Preloader';
import { traceClientLog } from './clientLogs';

//  Find out more information about the Game Config at:
//  https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  audio: { noAudio: true },
  backgroundColor: '#028af8',
  scale: {
    // Keep a fixed game resolution but automatically scale it to fit within the available
    // web-view / device while maintaining aspect ratio.
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1024,
    height: 768,
  },
  scene: [Boot, Preloader, MainMenu, MainGame, GameOver],
};

let currentGame: Game | undefined;

/** (Re)starts the Phaser game inside the element with id `parentId`. Idempotent:
 * calling it again (e.g. re-opening the "Rendering Demo" tab) tears down the
 * previous instance first rather than leaking a second running game loop. */
export const startPhaserGame = (parentId: string): Game => {
  traceClientLog('Starting Phaser rendering demo:', parentId);
  currentGame?.destroy(true);
  currentGame = new Game({ ...config, parent: parentId });
  console.info('Started Phaser rendering demo:', parentId);
  return currentGame;
};

/** Tears down the running game loop, e.g. when navigating away from the
 * "Rendering Demo" tab so it doesn't keep rendering in the background. */
export const stopPhaserGame = (): void => {
  if (currentGame) traceClientLog('Stopping Phaser rendering demo.');
  currentGame?.destroy(true);
  currentGame = undefined;
};
