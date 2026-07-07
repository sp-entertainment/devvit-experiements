import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnCommentCreateRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { context, redis } from '@devvit/web/server';
import { createPost } from '../core/post';

export const triggers = new Hono();

// Fires once, the moment a moderator installs the app in a subreddit.
triggers.post('/on-app-install', async (c) => {
  try {
    const post = await createPost();
    const input = await c.req.json<OnAppInstallRequest>();

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Post created in subreddit ${context.subredditName} with id ${post.id} (trigger: ${input.type})`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to create post',
      },
      400
    );
  }
});

// Fires every time any comment is created anywhere in the subreddit. Safe,
// non-destructive demo: just tally a global comment counter in Redis.
triggers.post('/on-comment-create', async (c) => {
  const input = await c.req.json<OnCommentCreateRequest>();
  const total = await redis.incrBy('trigger:comments-seen', 1);

  console.log(
    `onCommentCreate: comment ${input.comment?.id} by u/${input.author?.name} (running total: ${total})`
  );

  return c.json<TriggerResponse>({}, 200);
});
