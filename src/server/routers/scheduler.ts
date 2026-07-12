import { z } from 'zod';
import { context, scheduler } from '@devvit/web/server';
import { authenticatedProcedure, moderatorProcedure, router } from '../trpc';

export const schedulerRouter = router({
  // scheduler.runJob() with `runAt`: schedule a one-off job. The `reminder` task name
  // must be registered under `scheduler.tasks` in devvit.json, mapped to the endpoint
  // in src/server/routes/scheduler.ts that actually runs when the job fires.
  scheduleReminder: authenticatedProcedure
    .input(
      z.object({ delaySeconds: z.number().int().min(5).max(3600).default(30) })
    )
    .mutation(async ({ input }) => {
      if (!context.username) throw new Error('A Reddit username is required');
      const jobId = await scheduler.runJob({
        name: 'reminder',
        runAt: new Date(Date.now() + input.delaySeconds * 1000),
        data: { username: context.username },
      });
      return { jobId };
    }),

  // scheduler.listJobs(): every job (one-off + cron) currently scheduled for this install,
  // including the `dailyReset` cron task registered in devvit.json.
  listJobs: moderatorProcedure.query(async () => await scheduler.listJobs()),

  // scheduler.cancelJob(): cancel a previously scheduled one-off job by ID.
  cancelJob: moderatorProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input }) => {
      await scheduler.cancelJob(input.jobId);
      return { success: true };
    }),
});
