import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { buildInputs, hashBuildInputs } from './build-id.mjs';

void test('fingerprints source, public assets, dependencies, and build code', async () => {
  const inputs = await buildInputs();
  const names = new Set(inputs.map((path) => basename(path)));
  assert.equal(names.has('snoo.png'), true);
  assert.equal(names.has('package-lock.json'), true);
  assert.equal(names.has('build-id.mjs'), true);
  assert.equal(
    inputs.some((path) => path.includes('/src/client/game.html')),
    true
  );
});

void test('hash changes with file contents and is independent of input order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'devvit-build-id-'));
  const first = join(directory, 'first.txt');
  const second = join(directory, 'second.txt');
  try {
    await Promise.all([writeFile(first, 'one'), writeFile(second, 'two')]);
    const initial = await hashBuildInputs([first, second], directory);
    assert.equal(initial, await hashBuildInputs([second, first], directory));

    await writeFile(second, 'changed');
    assert.notEqual(initial, await hashBuildInputs([first, second], directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
