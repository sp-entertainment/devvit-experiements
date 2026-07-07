import { z } from 'zod';
import { context, redis } from '@devvit/web/server';
import { router, publicProcedure } from '../trpc';

const requirePostId = () => {
  if (!context.postId)
    throw new Error('postId is required but missing from context');
  return context.postId;
};

const requireUsername = () => {
  if (!context.username) throw new Error('Must be logged in');
  return context.username;
};

export const redisRouter = router({
  // Strings: redis.get / redis.incrBy - the classic per-post counter.
  counter: router({
    get: publicProcedure.query(async () => {
      const value = await redis.get(`counter:${requirePostId()}`);
      return { count: value ? parseInt(value) : 0 };
    }),
    increment: publicProcedure.mutation(async () => {
      return { count: await redis.incrBy(`counter:${requirePostId()}`, 1) };
    }),
    decrement: publicProcedure.mutation(async () => {
      return { count: await redis.incrBy(`counter:${requirePostId()}`, -1) };
    }),
  }),

  // Hashes: redis.hSet / redis.hGetAll - store a small structured record per user.
  hashProfile: router({
    get: publicProcedure.query(async () => {
      return await redis.hGetAll(
        `profile:${requirePostId()}:${requireUsername()}`
      );
    }),
    save: publicProcedure
      .input(
        z.object({
          favoriteColor: z.string().max(32),
          bio: z.string().max(280),
        })
      )
      .mutation(async ({ input }) => {
        const key = `profile:${requirePostId()}:${requireUsername()}`;
        await redis.hSet(key, {
          favoriteColor: input.favoriteColor,
          bio: input.bio,
        });
        return await redis.hGetAll(key);
      }),
  }),

  // Sorted sets: redis.zIncrBy / redis.zRange - the backbone of every Devvit leaderboard.
  leaderboard: router({
    top: publicProcedure.query(async () => {
      const key = `leaderboard:${requirePostId()}`;
      // by: 'rank', reverse: true -> highest score first.
      return await redis.zRange(key, 0, 9, { by: 'rank', reverse: true });
    }),
    addPoints: publicProcedure
      .input(z.object({ points: z.number().int().min(1).max(100) }))
      .mutation(async ({ input }) => {
        const key = `leaderboard:${requirePostId()}`;
        const score = await redis.zIncrBy(key, requireUsername(), input.points);
        return { username: requireUsername(), score };
      }),
  }),

  // Expiry: redis.set(..., { expiration }) + redis.expireTime - a value that self-destructs.
  withExpiry: router({
    set: publicProcedure
      .input(
        z.object({
          value: z.string().max(200),
          ttlSeconds: z.number().int().min(5).max(3600),
        })
      )
      .mutation(async ({ input }) => {
        const key = `expiring:${requirePostId()}`;
        await redis.set(key, input.value, {
          expiration: new Date(Date.now() + input.ttlSeconds * 1000),
        });
        return { success: true };
      }),
    get: publicProcedure.query(async () => {
      const key = `expiring:${requirePostId()}`;
      const [value, expireAt] = await Promise.all([
        redis.get(key),
        redis.expireTime(key),
      ]);
      return { value: value ?? null, expiresAt: value ? expireAt : null };
    }),
  }),

  // Transactions: redis.watch/.multi()/.exec() - optimistic-locking increment, guarding
  // against a lost update if two requests race on the same key.
  transactionDemo: router({
    increment: publicProcedure.mutation(async () => {
      const key = `txn-counter:${requirePostId()}`;
      const txn = await redis.watch(key);
      const current = await redis.get(key);
      const next = (current ? parseInt(current) : 0) + 1;
      await txn.multi();
      await txn.set(key, String(next));
      await txn.exec();
      return { count: next };
    }),
  }),

  // Global scope: redis.global - a key shared across every subreddit this app is
  // installed in, instead of being scoped to a single installation.
  globalScopeDemo: router({
    get: publicProcedure.query(async () => {
      const value = await redis.global.get('global:total-visits');
      return { totalVisits: value ? parseInt(value) : 0 };
    }),
    increment: publicProcedure.mutation(async () => {
      return {
        totalVisits: await redis.global.incrBy('global:total-visits', 1),
      };
    }),
  }),
});
