import { TRPCError, initTRPC } from '@trpc/server';
import { context, reddit } from '@devvit/web/server';

// Bare-bones tRPC setup (no custom context needed): every procedure reads
// request-scoped Devvit state directly from `context`/`redis`/`reddit`/etc.
// exported by `@devvit/web/server`, which are backed by Node's
// AsyncLocalStorage and already scoped to the current request.
const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;

const requireAuthenticatedUser = (): void => {
  if (!context.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to use this capability.',
    });
  }
};

const requireCurrentSubredditModerator = async (): Promise<void> => {
  requireAuthenticatedUser();
  const user = await reddit.getCurrentUser();
  if (!user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'The current Reddit account could not be resolved.',
    });
  }

  const permissions = await user.getModPermissionsForSubreddit(
    context.subredditName
  );
  if (permissions.length === 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This capability is restricted to subreddit moderators.',
    });
  }
};

export const authenticatedProcedure = t.procedure.use(async ({ next }) => {
  requireAuthenticatedUser();
  return await next();
});

export const moderatorProcedure = t.procedure.use(async ({ next }) => {
  await requireCurrentSubredditModerator();
  return await next();
});

// Re-exported here purely for a shorter import path from the client
// (`import type { AppRouter } from '../server/trpc'` reads oddly otherwise).
export type { AppRouter } from './routers/index';
