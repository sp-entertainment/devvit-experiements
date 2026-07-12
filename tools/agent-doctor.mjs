import { readFile, stat } from 'node:fs/promises';
import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import {
  inspectCredentials,
  isSupportedNodeVersion,
} from './agent-doctor-rules.mjs';

const root = resolve(import.meta.dirname, '..');
const credentialsPath = resolve(root, '.local/reddit-accounts.json');
const failures = [];

const fail = (message) => failures.push(message);

if (!isSupportedNodeVersion(process.versions.node)) {
  fail('Node.js 22.2.0 or newer is required.');
}

try {
  accessSync(resolve(root, 'node_modules/.bin/devvit'), constants.X_OK);
} catch {
  fail('Local Devvit CLI is unavailable; run npm ci.');
}

failures.push(
  ...(await inspectCredentials({ credentialsPath, readFile, stat }))
);

if (failures.length) {
  for (const failure of failures) console.error(`[agent:doctor] ${failure}`);
  process.exitCode = 1;
} else {
  console.info(
    '[agent:doctor] Environment is ready. Credentials were validated without printing them.'
  );
}
