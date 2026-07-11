import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const sourceDirectory = join(root, 'src');
const extraFiles = [
  'devvit.json',
  'package.json',
  'products.json',
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

export const buildInputs = async () => [
  ...(await sourceFiles(sourceDirectory)),
  ...extraFiles.map((file) => join(root, file)),
];

export const getBuildId = async () => {
  const hash = createHash('sha256');
  for (const path of await buildInputs()) {
    hash.update(relative(root, path));
    hash.update('\0');
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  process.stdout.write(`${await getBuildId()}\n`);
}
