import { defineConfig } from 'vite';
import { devvit } from '@devvit/start/vite';
import { execSync } from 'node:child_process';

const gitSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'nogit';
  }
})();
const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(`${gitSha} ${buildTime}Z`),
  },
  plugins: [
    devvit({
      client: {
        build: {
          chunkSizeWarningLimit: 2000,
        },
      },
    }),
  ],
});
