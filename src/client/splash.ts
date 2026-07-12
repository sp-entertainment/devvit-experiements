import { context, navigateTo, requestExpandedMode } from '@devvit/web/client';
import { buildId } from '../shared/buildInfo';

const requireButton = (id: string): HTMLButtonElement => {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`#${id} must be a button`);
  }
  return element;
};

const version = document.getElementById('app-version');
if (version) {
  version.textContent = `app v${context.appVersion} | build ${buildId}`;
}

const startButton = requireButton('start-button');
const docsLink = requireButton('docs-link');
const playtestLink = requireButton('playtest-link');
const discordLink = requireButton('discord-link');

startButton.addEventListener('click', (event) => {
  requestExpandedMode(event, 'game');
});

docsLink.addEventListener('click', () => {
  navigateTo('https://developers.reddit.com/docs');
});

playtestLink.addEventListener('click', () => {
  navigateTo('https://www.reddit.com/r/Devvit');
});

discordLink.addEventListener('click', () => {
  navigateTo('https://discord.com/invite/R7yu2wh9Qz');
});

const titleElement = document.getElementById('title');
if (!(titleElement instanceof HTMLHeadingElement)) {
  throw new Error('#title must be a heading');
}
titleElement.textContent = `Hey ${context.username ?? 'there'} 👋`;
