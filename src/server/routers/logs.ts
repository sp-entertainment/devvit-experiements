import { z } from 'zod';

import { moderatorProcedure, router } from '../trpc';
import {
  clearServerLogs,
  listServerLogs,
  setServerLogLimit,
} from '../core/serverLogs';

export const logsRouter = router({
  listServerLogs: moderatorProcedure.query(async () => await listServerLogs()),
  setServerLogLimit: moderatorProcedure
    .input(z.object({ limit: z.number().int().min(1).max(5000) }))
    .mutation(async ({ input }) => ({
      limit: await setServerLogLimit(input.limit),
    })),
  clearServerLogs: moderatorProcedure.mutation(async () => {
    await clearServerLogs();
    return { success: true };
  }),
});
