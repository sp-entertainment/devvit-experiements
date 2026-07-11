import { readFile, stat } from 'node:fs/promises';
import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const credentialsPath = resolve(root, '.local/reddit-accounts.json');
const failures = [];

const fail = (message) => failures.push(message);

const majorNodeVersion = Number(process.versions.node.split('.')[0]);
if (majorNodeVersion < 22) fail('Node.js 22 or newer is required.');

try {
  accessSync(resolve(root, 'node_modules/.bin/devvit'), constants.X_OK);
} catch {
  fail('Local Devvit CLI is unavailable; run npm ci.');
}

try {
  const metadata = await stat(credentialsPath);
  if ((metadata.mode & 0o077) !== 0)
    fail('Credential file permissions must not allow group or other access.');
  const accounts = JSON.parse(await readFile(credentialsPath, 'utf8'));
  const primary = accounts?.primary;
  const secondary = accounts?.secondary;
  if (
    typeof primary?.username !== 'string' ||
    !primary.username ||
    typeof primary?.password !== 'string' ||
    !primary.password ||
    typeof secondary?.username !== 'string' ||
    !secondary.username ||
    typeof secondary?.password !== 'string' ||
    !secondary.password ||
    primary.username === secondary.username
  ) {
    fail(
      'Credential file must contain distinct primary and secondary username/password pairs.'
    );
  }
} catch (error) {
  if (error instanceof SyntaxError) fail('Credential file is not valid JSON.');
  else if (failures.length === 0)
    fail('Credential file is missing or unreadable.');
}

if (failures.length) {
  for (const failure of failures) console.error(`[agent:doctor] ${failure}`);
  process.exitCode = 1;
} else {
  console.info(
    '[agent:doctor] Environment is ready. Credentials were validated without printing them.'
  );
}
