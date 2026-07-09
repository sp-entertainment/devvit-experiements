import { z } from 'zod';

import { publicProcedure, router } from '../trpc';
import {
  clearServerLogs,
  listServerLogs,
  setServerLogLimit,
} from '../core/serverLogs';

export const logsRouter = router({
  listServerLogs: publicProcedure.query(async () => await listServerLogs()),
  setServerLogLimit: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(5000) }))
    .mutation(async ({ input }) => ({
      limit: await setServerLogLimit(input.limit),
    })),
  clearServerLogs: publicProcedure.mutation(async () => {
    await clearServerLogs();
    return { success: true };
  }),
});
