import './clientLogs';
import { context, showToast } from '@devvit/web/client';
import {
  hasUnclearedErrors,
  subscribeClientLogs,
  traceClientLog,
} from './clientLogs';
import { categories } from './kitchenSink/categories';
import { el, errorMessage } from './kitchenSink/ui';
import { stopPhaserGame } from './phaserGame';
import { stopLightingHallwayDemo } from './lightingHallwayDemo';
import { stopPongGame } from './pongGame';
import { stopSharedCanvasDemo } from './sharedCanvasDemo';
import { stopSmoothMovementDemo } from './smoothMovementDemo';
import { stopTankGameDemo } from './tankGameDemo';

declare const __BUILD_ID__: string;

const version = document.getElementById('app-version');
if (version)
  version.textContent = `app v${context.appVersion} | build ${__BUILD_ID__}`;

const root = document.getElementById('kitchen-sink');
if (!root)
  throw new Error('#kitchen-sink root element is missing from game.html');

const header = document.createElement('header');
header.id = 'ks-header';

const title = document.createElement('h1');
title.textContent = 'Devvit Kitchen Sink';

const tabs = document.createElement('nav');
tabs.id = 'ks-tabs';

header.append(title, tabs);

const content = document.createElement('main');
content.id = 'ks-content';

root.append(header, content);

let activeId = categories[0]?.id;
let cleanupActive: (() => void) | undefined;

const updateTabState = (activeCategoryId: string) => {
  tabs.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    const isClientLogs = button.dataset.categoryId === 'client-logs';
    const hasErrors = isClientLogs && hasUnclearedErrors();
    button.classList.toggle(
      'ks-tab-active',
      button.dataset.categoryId === activeCategoryId
    );
    button.classList.toggle('ks-tab-error', hasErrors);
    button.setAttribute(
      'aria-label',
      hasErrors ? 'Client Logs: errors need clearing' : (button.textContent ?? '')
    );
  });
};

const renderActive = () => {
  const category = categories.find((c) => c.id === activeId) ?? categories[0];
  if (!category) return;

  cleanupActive?.();

  // Only one category's Phaser instance should ever be running at a time.
  if (category.id !== 'rendering') stopPhaserGame();
  if (category.id !== 'lighting-hallway') stopLightingHallwayDemo();
  if (category.id !== 'pong') stopPongGame();
  if (category.id !== 'smooth-movement') stopSmoothMovementDemo();
  if (category.id !== 'tank-game') stopTankGameDemo();
  if (category.id !== 'shared-canvas') stopSharedCanvasDemo();

  content.innerHTML = '';
  try {
    traceClientLog('Rendering client tab:', category.label);
    cleanupActive = category.build(content) ?? undefined;
  } catch (error) {
    const message = errorMessage(error);
    cleanupActive = undefined;
    const output = el('pre', 'ks-output ks-output-error');
    output.textContent = `Error: ${message}`;
    content.append(output);
    console.error('Failed to render client tab:', category.label, error);
    showToast(`Error: ${message}`);
  }

  updateTabState(category.id);
};

for (const category of categories) {
  const button = document.createElement('button');
  button.className = 'ks-tab';
  button.textContent = category.label;
  button.dataset.categoryId = category.id;
  button.addEventListener('click', () => {
    console.info('Selected client tab:', category.label);
    activeId = category.id;
    renderActive();
  });
  tabs.append(button);
}

subscribeClientLogs(() => updateTabState(activeId ?? ''));
console.info('Kitchen sink client initialized.');
renderActive();
