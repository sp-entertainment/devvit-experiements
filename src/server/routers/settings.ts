import { settings } from '@devvit/web/server';
import { router, publicProcedure } from '../trpc';

export const settingsRouter = router({
  // settings.get(): read a moderator-configurable app setting (defined under
  // `settings.subreddit` in devvit.json). Settings have no `.set()` - they're only
  // editable by moderators through the app's install-settings page on Reddit.
  getWelcomeMessage: publicProcedure.query(async () => {
    const welcomeMessage = await settings.get<string>('welcomeMessage');
    return {
      welcomeMessage: welcomeMessage ?? '(no welcome message configured yet)',
    };
  }),
});
