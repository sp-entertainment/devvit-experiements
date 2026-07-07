import { z } from 'zod';
import { media } from '@devvit/web/server';
import { router, publicProcedure } from '../trpc';

export const mediaRouter = router({
  // media.upload(): fetches a publicly reachable URL and re-hosts it on Reddit's media
  // CDN, returning a `mediaId` + `mediaUrl` you can render or attach to a post.
  uploadFromUrl: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
        type: z.enum(['image', 'gif', 'video']),
      })
    )
    .mutation(async ({ input }) => {
      const asset = await media.upload({ url: input.url, type: input.type });
      return asset;
    }),
});
