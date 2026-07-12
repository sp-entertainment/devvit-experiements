import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectCredentials,
  isSupportedNodeVersion,
} from './agent-doctor-rules.mjs';

test('the agent doctor enforces the package Node.js floor', () => {
  assert.equal(isSupportedNodeVersion('22.1.99'), false);
  assert.equal(isSupportedNodeVersion('22.2.0'), true);
  assert.equal(isSupportedNodeVersion('22.2.0-rc.1'), true);
  assert.equal(isSupportedNodeVersion('23.0.0'), true);
  assert.equal(isSupportedNodeVersion('invalid'), false);
});

test('credential read failures are not hidden by permission failures', async () => {
  const failures = await inspectCredentials({
    credentialsPath: '/credentials.json',
    readFile: async () => {
      throw new Error('unreadable');
    },
    stat: async () => ({ mode: 0o100644 }),
  });

  assert.deepEqual(failures, [
    'Credential file permissions must not allow group or other access.',
    'Credential file is missing or unreadable.',
  ]);
});

test('credential validation requires two distinct complete accounts', async () => {
  const failures = await inspectCredentials({
    credentialsPath: '/credentials.json',
    readFile: async () =>
      JSON.stringify({
        primary: { username: 'same', password: 'secret' },
        secondary: { username: 'same', password: 'secret' },
      }),
    stat: async () => ({ mode: 0o100600 }),
  });

  assert.deepEqual(failures, [
    'Credential file must contain distinct primary and secondary username/password pairs.',
  ]);
});
