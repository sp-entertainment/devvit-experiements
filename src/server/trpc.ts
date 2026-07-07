import { initTRPC } from '@trpc/server';

// Bare-bones tRPC setup (no custom context needed): every procedure reads
// request-scoped Devvit state directly from `context`/`redis`/`reddit`/etc.
// exported by `@devvit/web/server`, which are backed by Node's
// AsyncLocalStorage and already scoped to the current request.
const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Re-exported here purely for a shorter import path from the client
// (`import type { AppRouter } from '../server/trpc'` reads oddly otherwise).
export type { AppRouter } from './routers/index';
