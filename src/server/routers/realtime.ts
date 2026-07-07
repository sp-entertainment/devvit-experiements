import { z } from 'zod';
import { context, realtime } from '@devvit/web/server';
import { router, publicProcedure } from '../trpc';
import type { RealtimeCursorMessage } from '../../shared/realtime';

export const realtimeRouter = router({
  // realtime.send(): publish a JSON message to every client subscribed to this post's
  // channel via `connectRealtime` on the client. There is no client -> client messaging;
  // every message is relayed through this server call.
  broadcastCursor: publicProcedure
    .input(z.object({ x: z.number(), y: z.number() }))
    .mutation(async ({ input }) => {
      if (!context.postId)
        throw new Error('postId is required but missing from context');

      const message: RealtimeCursorMessage = {
        userId: context.userId ?? 'anonymous',
        username: context.username ?? 'anonymous',
        x: input.x,
        y: input.y,
        sentAt: Date.now(),
      };
      await realtime.send<RealtimeCursorMessage>(context.postId, message);
      return { success: true };
    }),
});
