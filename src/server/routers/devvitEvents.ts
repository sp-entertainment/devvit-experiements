import { getDevvitEventSnapshot } from '../core/devvitEvents';
import { moderatorProcedure, router } from '../trpc';

export const devvitEventsRouter = router({
  snapshot: moderatorProcedure.query(
    async () => await getDevvitEventSnapshot()
  ),
});
