import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const inputDirectories = ['public', 'src'];
const extraFiles = [
  'devvit.json',
  'package-lock.json',
  'package.json',
  'products.json',
  'tools/build-id.mjs',
  'vite.config.ts',
];

const sourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() ? [path] : [];
    })
  );
  return files.flat().sort();
};

export const buildInputs = async () =>
  [
    ...(
      await Promise.all(
        inputDirectories.map((directory) => sourceFiles(join(root, directory)))
      )
    ).flat(),
    ...extraFiles.map((file) => join(root, file)),
  ].sort();

export const hashBuildInputs = async (paths, baseDirectory = root) => {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    hash.update(relative(baseDirectory, path));
    hash.update('\0');
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return hash.digest('hex');
};

export const getBuildId = async () =>
  (await hashBuildInputs(await buildInputs())).slice(0, 12);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${await getBuildId()}\n`);
}
