import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnCommentCreateRequest,
  OnCommentSubmitRequest,
  OnModActionRequest,
  OnPostReportRequest,
  OnPostSubmitRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { context, redis } from '@devvit/web/server';
import { createPost } from '../core/post';
import { recordTrigger } from '../core/devvitEvents';

export const triggers = new Hono();

const short = (value: string | undefined) => (value ?? '').slice(0, 80);

const userName = (user: { name: string } | undefined) =>
  user?.name ?? 'unknown';

const subredditName = (subreddit: { name: string } | undefined) =>
  subreddit?.name ?? context.subredditName ?? 'unknown';

const postSummary = (post: { id: string; title: string } | undefined) => ({
  postId: post?.id ?? 'unknown',
  postTitle: short(post?.title),
});

const commentSummary = (
  comment: { id: string; body: string; postId: string } | undefined
) => ({
  commentId: comment?.id ?? 'unknown',
  commentBody: short(comment?.body),
  postId: comment?.postId ?? 'unknown',
});

// Fires once, the moment a moderator installs the app in a subreddit.
triggers.post('/on-app-install', async (c) => {
  const post = await createPost();
  const input = await c.req.json<OnAppInstallRequest>();

  return c.json<TriggerResponse>(
    {
      status: 'success',
      message: `Post created in subreddit ${context.subredditName} with id ${post.id} (trigger: ${input.type})`,
    },
    200
  );
});

// Fires every time any comment is created anywhere in the subreddit. Safe,
// non-destructive demo: just tally a global comment counter in Redis.
triggers.post('/on-comment-create', async (c) => {
  const input = await c.req.json<OnCommentCreateRequest>();
  const total = await redis.incrBy('trigger:comments-seen', 1);
  await recordTrigger('CommentCreate', {
    ...commentSummary(input.comment),
    author: userName(input.author),
    subreddit: subredditName(input.subreddit),
  });

  console.info(
    `onCommentCreate: comment ${input.comment?.id} by u/${input.author?.name} (running total: ${total})`
  );

  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-post-submit', async (c) => {
  const input = await c.req.json<OnPostSubmitRequest>();
  await recordTrigger('PostSubmit', {
    ...postSummary(input.post),
    author: userName(input.author),
    subreddit: subredditName(input.subreddit),
  });

  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-comment-submit', async (c) => {
  const input = await c.req.json<OnCommentSubmitRequest>();
  await recordTrigger('CommentSubmit', {
    ...commentSummary(input.comment),
    author: userName(input.author),
    subreddit: subredditName(input.subreddit),
  });

  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-post-report', async (c) => {
  const input = await c.req.json<OnPostReportRequest>();
  await recordTrigger('PostReport', {
    ...postSummary(input.post),
    reason: short(input.reason),
    subreddit: subredditName(input.subreddit),
  });

  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-mod-action', async (c) => {
  const input = await c.req.json<OnModActionRequest>();
  await recordTrigger('ModAction', {
    action: input.action ?? 'unknown',
    moderator: userName(input.moderator),
    targetPostId: input.targetPost?.id ?? 'none',
    targetCommentId: input.targetComment?.id ?? 'none',
    subreddit: subredditName(input.subreddit),
  });

  return c.json<TriggerResponse>({}, 200);
});

triggers.onError((error, c) => {
  console.error('Trigger route failed:', error);
  return c.json<TriggerResponse>(
    {
      status: 'error',
      message: 'Trigger processing failed',
    },
    500
  );
});
