import { defineConfig, type Plugin } from 'vite';
import { devvit } from '@devvit/start/vite';
import { getBuildId, buildInputs } from './tools/build-id.mjs';

const buildInfoPlugin = (): Plugin => ({
  name: 'agent-build-info',
  resolveId: (id: string) =>
    id === 'virtual:agent-build-info'
      ? '\0virtual:agent-build-info'
      : undefined,
  async load(id: string) {
    if (id !== '\0virtual:agent-build-info') return undefined;
    for (const input of await buildInputs()) this.addWatchFile(input);
    const buildId = await getBuildId();
    console.info(`[agent] build ${buildId}`);
    return `export const buildId = ${JSON.stringify(buildId)};`;
  },
});

export default defineConfig({
  plugins: [
    buildInfoPlugin(),
    devvit({
      client: {
        build: {
          chunkSizeWarningLimit: 2000,
        },
      },
    }),
  ],
});
