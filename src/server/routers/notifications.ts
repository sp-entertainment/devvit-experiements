import { z } from 'zod';
import { context, notifications } from '@devvit/web/server';
import { router, publicProcedure } from '../trpc';

// NOTE: Push notifications are an @experimental Devvit capability. Delivery to real
// devices requires the app to be approved for the notifications permission - these
// procedures will run and return without error pre-approval, but users won't
// actually receive a push until then.

const requireUserId = () => {
  if (!context.userId) throw new Error('Must be logged in');
  return context.userId;
};

export const notificationsRouter = router({
  // notifications.optInCurrentUser() / .optOutCurrentUser(): per-user push preference.
  optIn: publicProcedure.mutation(
    async () => await notifications.optInCurrentUser()
  ),
  optOut: publicProcedure.mutation(
    async () => await notifications.optOutCurrentUser()
  ),

  // notifications.isOptedIn(): check the calling user's current opt-in state.
  checkOptedIn: publicProcedure.query(async () => {
    return { optedIn: await notifications.isOptedIn(requireUserId()) };
  }),

  // notifications.enqueue(): queue a push notification (title/body support mustache
  // templating) to up to 1000 recipients - here, just the calling user, as a test.
  sendTestPush: publicProcedure
    .input(
      z.object({
        title: z.string().min(1).max(80),
        body: z.string().min(1).max(200),
      })
    )
    .mutation(async ({ input }) => {
      if (!context.postId)
        throw new Error('postId is required but missing from context');
      return await notifications.enqueue({
        title: input.title,
        body: input.body,
        recipients: [
          { userId: requireUserId(), link: context.postId, data: {} },
        ],
      });
    }),

  // Game badge helpers: surface a small badge on the post icon in-feed.
  gameBadge: router({
    request: publicProcedure.mutation(async () => {
      if (!context.postId)
        throw new Error('postId is required but missing from context');
      return await notifications.requestShowGameBadge({ post: context.postId });
    }),
    dismiss: publicProcedure.mutation(
      async () => await notifications.dismissGameBadge()
    ),
    status: publicProcedure.query(
      async () => await notifications.getGameBadgeStatus()
    ),
  }),
});
