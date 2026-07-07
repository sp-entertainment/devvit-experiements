import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../server/trpc';

// A plain (non-React) tRPC client. Requests go to same-origin `/api/trpc`, where
// `@devvit/web-view-scripts` has already patched `fetch` to attach the Devvit auth
// bearer token automatically - no manual headers needed here.
export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: '/api/trpc' })],
});
