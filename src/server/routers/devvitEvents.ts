import { getDevvitEventSnapshot } from '../core/devvitEvents';
import { router, publicProcedure } from '../trpc';

export const devvitEventsRouter = router({
  snapshot: publicProcedure.query(async () => await getDevvitEventSnapshot()),
});
