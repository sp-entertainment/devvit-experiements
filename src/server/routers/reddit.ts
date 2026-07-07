import { z } from 'zod';
import { context, reddit } from '@devvit/web/server';
import { router, publicProcedure } from '../trpc';

const requirePostId = () => {
  if (!context.postId)
    throw new Error('postId is required but missing from context');
  return context.postId;
};

export const redditRouter = router({
  // reddit.getCurrentUser() + reddit.getSnoovatarUrl(): read info about the calling Redditor.
  getMe: publicProcedure.query(async () => {
    const user = await reddit.getCurrentUser();
    const snoovatarUrl = user
      ? await reddit.getSnoovatarUrl(user.username)
      : undefined;
    return {
      username: user?.username ?? context.username ?? 'anonymous',
      userId: user?.id,
      linkKarma: user?.linkKarma,
      commentKarma: user?.commentKarma,
      snoovatarUrl,
    };
  }),

  // reddit.getCurrentSubreddit(): metadata about the subreddit this app is installed in.
  getSubredditInfo: publicProcedure.query(async () => {
    const subreddit = await reddit.getCurrentSubreddit();
    return {
      id: subreddit.id,
      name: subreddit.name,
      title: subreddit.title,
      numberOfSubscribers: subreddit.numberOfSubscribers,
      numberOfActiveUsers: subreddit.numberOfActiveUsers,
    };
  }),

  // reddit.getHotPosts(): read a public listing from the subreddit.
  getHotPosts: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(25).default(5) }))
    .query(async ({ input }) => {
      const posts = await reddit
        .getHotPosts({
          subredditName: context.subredditName,
          limit: input.limit,
        })
        .all();
      return posts.map((post) => ({
        id: post.id,
        title: post.title,
        authorName: post.authorName,
        score: post.score,
        numberOfComments: post.numberOfComments,
        permalink: post.permalink,
      }));
    }),

  // reddit.submitCustomPost(): the classic "Hello World" example - creates a brand new
  // Devvit interactive post in the current subreddit on behalf of the app account.
  createHelloWorldPost: publicProcedure.mutation(async () => {
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName,
      title: 'Hello World from Devvit!',
      postData: {
        createdBy: context.username ?? 'anonymous',
        createdAt: Date.now(),
      },
    });
    return { id: post.id, url: post.permalink, title: post.title };
  }),

  // reddit.submitComment(): reply directly on the post the kitchen sink is running in.
  commentOnPost: publicProcedure
    .input(z.object({ text: z.string().min(1).max(2000) }))
    .mutation(async ({ input }) => {
      const comment = await reddit.submitComment({
        id: requirePostId(),
        text: input.text,
      });
      return { id: comment.id, permalink: comment.permalink };
    }),

  // reddit.setUserFlair(): set the calling user's flair in the current subreddit.
  setMyFlair: publicProcedure
    .input(z.object({ text: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      if (!context.username) throw new Error('Must be logged in to set flair');
      await reddit.setUserFlair({
        subredditName: context.subredditName,
        username: context.username,
        text: input.text,
      });
      return { success: true };
    }),

  // reddit.getPostData() / reddit.setPostData(): small (<2KB) JSON blob attached directly
  // to a custom post - handy for lightweight per-post config that doesn't need Redis.
  postData: router({
    get: publicProcedure.query(async () => {
      return (await reddit.getPostData(requirePostId())) ?? null;
    }),
    set: publicProcedure
      .input(z.object({ note: z.string().max(200) }))
      .mutation(async ({ input }) => {
        await reddit.setPostData(requirePostId(), {
          note: input.note,
          updatedAt: Date.now(),
        });
        return { success: true };
      }),
  }),

  // reddit.createShareUrl(): produce a shortened, shareable link to the current post.
  createShareUrl: publicProcedure.mutation(async () => {
    const post = await reddit.getPostById(requirePostId());
    return { shareUrl: await reddit.createShareUrl(post.url) };
  }),
});
