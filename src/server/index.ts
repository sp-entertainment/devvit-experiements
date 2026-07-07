import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { trpcServer } from '@hono/trpc-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { appRouter } from './routers/index';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { triggers } from './routes/triggers';
import { scheduler } from './routes/scheduler';
import { payments } from './routes/payments';

const app = new Hono();
const internal = new Hono();

// Everything the client actively calls (Reddit API, Redis, realtime publish, media,
// notifications, payments reads, settings, cache) is exposed as a single typed tRPC
// API - see src/server/routers/index.ts and src/client/trpc.ts.
app.use(
  '/api/trpc/*',
  trpcServer({ router: appRouter, endpoint: '/api/trpc' })
);

// Everything Devvit itself calls by a fixed URL contract (menu items, form submits,
// triggers, scheduled tasks, payment fulfillment) stays as plain Hono routes, wired up
// in devvit.json.
internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);
internal.route('/scheduler', scheduler);
internal.route('/payments', payments);

app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
