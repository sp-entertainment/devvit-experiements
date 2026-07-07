import { cache } from '@devvit/web/server';
import { router, publicProcedure } from '../trpc';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const cacheRouter = router({
  // cache(): Redis-backed memoization from @devvit/cache. The wrapped function only
  // actually runs once per `ttl` window (per `key`) - repeated calls within that
  // window return the cached value instantly instead of re-running the slow work.
  cachedSlowValue: publicProcedure.query(async () => {
    const start = Date.now();
    const result = await cache(
      async () => {
        await sleep(2000); // simulate a slow computation / external API call
        return { computedAt: Date.now(), random: Math.random() };
      },
      { key: 'kitchen-sink:slow-value', ttl: 30 }
    );
    return { ...result, tookMs: Date.now() - start };
  }),
});
