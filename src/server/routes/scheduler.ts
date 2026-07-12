import { Hono } from 'hono';
import { reddit, redis } from '@devvit/web/server';

export const scheduler = new Hono();

// Shape of the body Devvit POSTs to a `scheduler.tasks.<name>.endpoint` when a
// scheduled job fires (mirrors `@devvit/scheduler`'s `TaskRequest`/`TaskResponse`).
type ReminderJobData = { username?: string };
type TaskRequest<Data> = { name: string; data: Data };
type TaskResponse = Record<string, never>;

// Fires once, whenever `scheduler.runJob({ name: 'reminder', runAt, data })` is called
// (see src/server/routers/scheduler.ts). Registered with no `cron` under
// `scheduler.tasks.reminder` in devvit.json, so it's only ever triggered dynamically.
scheduler.post('/reminder', async (c) => {
  const { data } = await c.req.json<TaskRequest<ReminderJobData>>();
  const username = data?.username;

  if (!username) throw new Error('Reminder task is missing its username');
  await reddit.sendPrivateMessage({
    to: username,
    subject: 'Devvit Kitchen Sink reminder',
    text: 'Here is the reminder you scheduled a moment ago via `scheduler.runJob`.',
  });

  return c.json<TaskResponse>({}, 200);
});

// Fires automatically on the cron schedule set under `scheduler.tasks.dailyReset` in
// devvit.json (recurring, no manual `runJob` call needed - Devvit reschedules it after
// every app install/upgrade).
scheduler.post('/daily-reset', async (c) => {
  await redis.del('trigger:comments-seen');
  console.info('dailyReset cron task ran: reset the comment counter.');
  return c.json<TaskResponse>({}, 200);
});

scheduler.onError((error, c) => {
  console.error('Scheduler route failed:', error);
  return c.json<TaskResponse>({}, 500);
});
