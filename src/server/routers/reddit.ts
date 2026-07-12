import { z } from 'zod';
import { context, reddit } from '@devvit/web/server';
import type {
  Comment,
  FlairTemplate,
  Post,
  Rule,
  User,
  WikiPage,
  WikiPageRevision,
} from '@devvit/web/server';
import { router, publicProcedure } from '../trpc';

const requirePostId = () => {
  if (!context.postId)
    throw new Error('postId is required but missing from context');
  return context.postId;
};

type CommentId = `t1_${string}`;
type PostId = `t3_${string}`;

const sandboxWikiPage = 'devvit-kitchen-sink-sandbox';

const isCommentId = (id: string): id is CommentId => id.startsWith('t1_');
const isPostId = (id: string): id is PostId => id.startsWith('t3_');

const commentIdInput = z.string().refine(isCommentId, {
  message: 'Comment ID must start with t1_',
});
const postIdInput = z.string().refine(isPostId, {
  message: 'Post ID must start with t3_',
});

const summarizePost = (post: Post) => ({
  id: post.id,
  title: post.title,
  authorName: post.authorName,
  subredditName: post.subredditName,
  score: post.score,
  numberOfComments: post.numberOfComments,
  numberOfReports: post.numberOfReports,
  createdAt: post.createdAt.toISOString(),
  permalink: post.permalink,
  url: post.url,
  flairText: post.flair?.text ?? null,
  nsfw: post.nsfw,
  spoiler: post.spoiler,
  locked: post.locked,
  removed: post.removed,
});

const summarizeComment = (comment: Comment) => ({
  id: comment.id,
  authorName: comment.authorName,
  body: comment.body,
  score: comment.score,
  postId: comment.postId,
  parentId: comment.parentId,
  createdAt: comment.createdAt.toISOString(),
  permalink: comment.permalink,
  removed: comment.removed,
  spam: comment.spam,
  locked: comment.locked,
  numReports: comment.numReports,
});

const summarizeUser = (user: User) => ({
  id: user.id,
  username: user.username,
  createdAt: user.createdAt.toISOString(),
  linkKarma: user.linkKarma,
  commentKarma: user.commentKarma,
  nsfw: user.nsfw,
  isAdmin: user.isAdmin,
  isModerator: user.isModerator,
  hasRedditPremium: user.hasRedditPremium,
  permalink: user.permalink,
  url: user.url,
});

const summarizeFlairTemplate = (template: FlairTemplate) => ({
  id: template.id,
  text: template.text,
  textColor: template.textColor,
  backgroundColor: template.backgroundColor,
  allowableContent: template.allowableContent,
  modOnly: template.modOnly,
  allowUserEdits: template.allowUserEdits,
});

const summarizeRule = (rule: Rule) => ({
  shortName: rule.shortName,
  description: rule.description,
  kind: rule.kind,
  violationReason: rule.violationReason,
  priority: rule.priority,
  createdUtc: rule.createdUtc,
});

const summarizeWikiPage = (page: WikiPage) => ({
  page: page.name,
  subredditName: page.subredditName,
  content: page.content,
  revisionId: page.revisionId,
  revisionDate: page.revisionDate.toISOString(),
  revisionReason: page.revisionReason,
  revisionAuthor: page.revisionAuthor?.username ?? null,
});

const summarizeWikiRevision = (revision: WikiPageRevision) => ({
  id: revision.id,
  page: revision.page,
  date: revision.date.toISOString(),
  authorName: revision.author.username,
  reason: revision.reason,
  hidden: revision.hidden,
});

const summarizeModerationThing = (thing: Post | Comment) => {
  if ('title' in thing) return { kind: 'post', ...summarizePost(thing) };
  return { kind: 'comment', ...summarizeComment(thing) };
};

const listingOptions = (limit: number) => ({
  subredditName: context.subredditName,
  limit,
});

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

  listings: router({
    // Compare the common listing endpoints side by side; useful for seeing sort behavior.
    compare: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(10).default(3) }))
      .query(async ({ input }) => {
        const base = listingOptions(input.limit);
        const [hot, newest, rising, topDay, controversialDay] =
          await Promise.all([
            reddit.getHotPosts(base).all(),
            reddit.getNewPosts(base).all(),
            reddit.getRisingPosts(base).all(),
            reddit.getTopPosts({ ...base, timeframe: 'day' }).all(),
            reddit.getControversialPosts({ ...base, timeframe: 'day' }).all(),
          ]);
        return {
          hot: hot.map(summarizePost),
          new: newest.map(summarizePost),
          rising: rising.map(summarizePost),
          topDay: topDay.map(summarizePost),
          controversialDay: controversialDay.map(summarizePost),
        };
      }),
  }),

  inspect: router({
    currentPost: publicProcedure
      .input(
        z.object({ commentsLimit: z.number().int().min(0).max(20).default(5) })
      )
      .query(async ({ input }) => {
        const postId = requirePostId();
        const post = await reddit.getPostById(postId);
        const comments =
          input.commentsLimit > 0
            ? await reddit
                .getComments({ postId, limit: input.commentsLimit })
                .all()
            : [];
        return {
          post: summarizePost(post),
          comments: comments.map(summarizeComment),
        };
      }),
    post: publicProcedure
      .input(z.object({ postId: postIdInput }))
      .query(async ({ input }) => {
        const post = await reddit.getPostById(input.postId);
        return summarizePost(post);
      }),
    comment: publicProcedure
      .input(z.object({ commentId: commentIdInput }))
      .query(async ({ input }) => {
        const comment = await reddit.getCommentById(input.commentId);
        return summarizeComment(comment);
      }),
    user: publicProcedure
      .input(z.object({ username: z.string().min(1).max(20) }))
      .query(async ({ input }) => {
        const user = await reddit.getUserByUsername(
          input.username.replace(/^u\//, '')
        );
        return user ? summarizeUser(user) : null;
      }),
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

  userActions: router({
    // User Action scopes let this run as the viewer instead of the app account.
    submitPostAsUser: publicProcedure
      .input(
        z.object({
          title: z
            .string()
            .min(1)
            .max(300)
            .default('[Kitchen Sink] user-action test - delete me'),
          text: z
            .string()
            .min(1)
            .max(4000)
            .default('Created from a Devvit kitchen-sink runAs: USER example.'),
        })
      )
      .mutation(async ({ input }) => {
        const post = await reddit.submitPost({
          subredditName: context.subredditName,
          title: input.title,
          text: input.text,
          runAs: 'USER',
        });
        return summarizePost(post);
      }),
    commentOnCurrentPostAsUser: publicProcedure
      .input(
        z.object({
          text: z
            .string()
            .min(1)
            .max(2000)
            .default('[Kitchen Sink] user-action comment - delete me'),
        })
      )
      .mutation(async ({ input }) => {
        const comment = await reddit.submitComment({
          id: requirePostId(),
          text: input.text,
          runAs: 'USER',
        });
        return summarizeComment(comment);
      }),
    subscribeAsUser: publicProcedure.mutation(async () => {
      await reddit.subscribeToCurrentSubreddit();
      return { success: true };
    }),
    unsubscribeAsUser: publicProcedure.mutation(async () => {
      await reddit.unsubscribeFromCurrentSubreddit();
      return {
        success: true,
        note: 'Devvit exposes subscribe as a user action; unsubscribe uses the SDK method as-is.',
      };
    }),
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

  flair: router({
    templates: publicProcedure.query(async () => {
      const [postFlairs, userFlairs] = await Promise.all([
        reddit.getPostFlairTemplates(context.subredditName),
        reddit.getUserFlairTemplates(context.subredditName),
      ]);
      return {
        postFlairs: postFlairs.map(summarizeFlairTemplate),
        userFlairs: userFlairs.map(summarizeFlairTemplate),
      };
    }),
    setPost: publicProcedure
      .input(
        z.object({
          postId: postIdInput.optional(),
          text: z.string().min(1).max(64).default('Kitchen Sink'),
        })
      )
      .mutation(async ({ input }) => {
        const postId = input.postId ?? requirePostId();
        await reddit.setPostFlair({
          subredditName: context.subredditName,
          postId,
          text: input.text,
        });
        return { success: true, postId, text: input.text };
      }),
    removePost: publicProcedure
      .input(z.object({ postId: postIdInput.optional() }))
      .mutation(async ({ input }) => {
        const postId = input.postId ?? requirePostId();
        await reddit.removePostFlair(context.subredditName, postId);
        return { success: true, postId };
      }),
  }),

  wiki: router({
    readSandbox: publicProcedure.query(async () => {
      try {
        const page = await reddit.getWikiPage(
          context.subredditName,
          sandboxWikiPage
        );
        return summarizeWikiPage(page);
      } catch (error) {
        return {
          page: sandboxWikiPage,
          missing: true,
          message:
            'Sandbox page is missing or unavailable. Run updateSandbox to create it.',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
    updateSandbox: publicProcedure
      .input(z.object({ markdown: z.string().min(1).max(4000) }))
      .mutation(async ({ input }) => {
        try {
          const page = await reddit.updateWikiPage({
            subredditName: context.subredditName,
            page: sandboxWikiPage,
            content: input.markdown,
            reason: 'Devvit kitchen sink sandbox update',
          });
          return summarizeWikiPage(page);
        } catch {
          const page = await reddit.createWikiPage({
            subredditName: context.subredditName,
            page: sandboxWikiPage,
            content: input.markdown,
            reason: 'Devvit kitchen sink sandbox create',
          });
          return summarizeWikiPage(page);
        }
      }),
    revisions: publicProcedure.query(async () => {
      const revisions = await reddit
        .getWikiPageRevisions({
          subredditName: context.subredditName,
          page: sandboxWikiPage,
          limit: 5,
        })
        .all();
      return revisions.map(summarizeWikiRevision);
    }),
  }),

  moderation: router({
    snapshot: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(10).default(5) }))
      .query(async ({ input }) => {
        const [rules, modQueue, reports] = await Promise.all([
          reddit.getRules(context.subredditName),
          reddit
            .getModQueue({
              subreddit: context.subredditName,
              type: 'all',
              limit: input.limit,
            })
            .all(),
          reddit
            .getReports({
              subreddit: context.subredditName,
              type: 'all',
              limit: input.limit,
            })
            .all(),
        ]);
        return {
          rules: rules.map(summarizeRule),
          modQueue: modQueue.map(summarizeModerationThing),
          reports: reports.map(summarizeModerationThing),
        };
      }),
  }),
});
