import { router } from '../trpc';
import { redditRouter } from './reddit';
import { redisRouter } from './redis';
import { realtimeRouter } from './realtime';
import { mediaRouter } from './media';
import { notificationsRouter } from './notifications';
import { paymentsRouter } from './payments';
import { schedulerRouter } from './scheduler';
import { settingsRouter } from './settings';
import { cacheRouter } from './cache';
import { devvitEventsRouter } from './devvitEvents';

// One category per Devvit capability. Each is browsable from the kitchen-sink UI
// (src/client/kitchenSink.ts) under a matching category tab.
export const appRouter = router({
  reddit: redditRouter,
  redis: redisRouter,
  realtime: realtimeRouter,
  media: mediaRouter,
  notifications: notificationsRouter,
  payments: paymentsRouter,
  scheduler: schedulerRouter,
  settings: settingsRouter,
  cache: cacheRouter,
  devvitEvents: devvitEventsRouter,
});

export type AppRouter = typeof appRouter;
