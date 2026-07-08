import { showToast } from '@devvit/web/client';
import { categories } from './kitchenSink/categories';
import { el, errorMessage } from './kitchenSink/ui';
import { stopPhaserGame } from './phaserGame';

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

const renderActive = () => {
  const category = categories.find((c) => c.id === activeId) ?? categories[0];
  if (!category) return;

  cleanupActive?.();

  // Only one category's Phaser instance should ever be running at a time.
  if (category.id !== 'rendering') stopPhaserGame();

  content.innerHTML = '';
  try {
    cleanupActive = category.build(content) ?? undefined;
  } catch (error) {
    const message = errorMessage(error);
    cleanupActive = undefined;
    const output = el('pre', 'ks-output ks-output-error');
    output.textContent = `Error: ${message}`;
    content.append(output);
    showToast(`Error: ${message}`);
  }

  tabs.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.classList.toggle(
      'ks-tab-active',
      button.dataset.categoryId === category.id
    );
  });
};

for (const category of categories) {
  const button = document.createElement('button');
  button.className = 'ks-tab';
  button.textContent = category.label;
  button.dataset.categoryId = category.id;
  button.addEventListener('click', () => {
    activeId = category.id;
    renderActive();
  });
  tabs.append(button);
}

renderActive();
