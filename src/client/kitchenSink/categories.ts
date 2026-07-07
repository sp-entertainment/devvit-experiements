import {
  context,
  exitExpandedMode,
  getShareData,
  navigateTo,
  purchase,
  requestExpandedMode,
  showForm,
  showLoginPrompt,
  showShareSheet,
  showToast,
} from '@devvit/web/client';
import { trpc } from '../trpc';
import { el, exampleRow, paragraph, sectionHeading } from './ui';
import { startPhaserGame } from '../phaserGame';
import { onCursorConnectionChange, onCursorMessage } from '../realtimeChannel';

export type Category = {
  id: string;
  label: string;
  /** Returns an optional cleanup function, called when the user navigates to a
   * different tab (e.g. to unsubscribe from realtime listeners). */
  build: (container: HTMLElement) => void | (() => void);
};

const buildReddit = (container: HTMLElement) => {
  container.append(
    sectionHeading('Reddit API'),
    paragraph('Server-side calls to @devvit/reddit, proxied through tRPC.'),
    exampleRow({
      title: 'getCurrentUser + getSnoovatarUrl',
      description: 'Read info about the Redditor viewing this app.',
      run: () => trpc.reddit.getMe.query(),
    }),
    exampleRow({
      title: 'getCurrentSubreddit',
      description:
        'Read metadata about the subreddit this app is installed in.',
      run: () => trpc.reddit.getSubredditInfo.query(),
    }),
    exampleRow({
      title: 'getHotPosts',
      description: 'Fetch a public listing of hot posts from this subreddit.',
      inputs: [
        { id: 'limit', label: 'limit', type: 'number', defaultValue: '5' },
      ],
      run: (values) =>
        trpc.reddit.getHotPosts.query({ limit: Number(values('limit')) || 5 }),
    }),
    exampleRow({
      title: 'submitCustomPost ("Hello World")',
      description:
        'Create a brand new Devvit interactive post in this subreddit.',
      buttonLabel: 'Create post',
      run: () => trpc.reddit.createHelloWorldPost.mutate(),
    }),
    exampleRow({
      title: 'submitComment',
      description: 'Post a comment on the post this app is running in.',
      inputs: [
        {
          id: 'text',
          label: 'text',
          defaultValue: 'Hello from the kitchen sink!',
        },
      ],
      run: (values) =>
        trpc.reddit.commentOnPost.mutate({ text: values('text') }),
    }),
    exampleRow({
      title: 'setUserFlair',
      description: 'Set your own user flair in this subreddit.',
      inputs: [
        {
          id: 'text',
          label: 'flair text',
          defaultValue: 'Kitchen Sink Tester',
        },
      ],
      run: (values) => trpc.reddit.setMyFlair.mutate({ text: values('text') }),
    }),
    exampleRow({
      title: 'getPostData / setPostData',
      description:
        'Read then write a small JSON blob attached directly to this post.',
      inputs: [
        { id: 'note', label: 'note', defaultValue: 'set from the client!' },
      ],
      run: async (values) => {
        const before = await trpc.reddit.postData.get.query();
        await trpc.reddit.postData.set.mutate({ note: values('note') });
        const after = await trpc.reddit.postData.get.query();
        return { before, after };
      },
    }),
    exampleRow({
      title: 'createShareUrl',
      description: 'Generate a shortened, shareable link to this post.',
      run: () => trpc.reddit.createShareUrl.mutate(),
    })
  );
};

const buildRedis = (container: HTMLElement) => {
  container.append(
    sectionHeading('Redis'),
    paragraph(
      'The managed Redis-like store from @devvit/redis, scoped per install.'
    ),
    exampleRow({
      title: 'Strings: get / incrBy',
      description: 'A per-post counter backed by a single Redis string key.',
      buttonLabel: 'Increment',
      run: () => trpc.redis.counter.increment.mutate(),
    }),
    exampleRow({
      title: 'Strings: read counter',
      description: 'Read the current counter value without changing it.',
      buttonLabel: 'Read',
      run: () => trpc.redis.counter.get.query(),
    }),
    exampleRow({
      title: 'Hashes: hSet / hGetAll',
      description:
        'Save a small structured profile record for the current user.',
      inputs: [
        {
          id: 'favoriteColor',
          label: 'favorite color',
          defaultValue: 'purple',
        },
        {
          id: 'bio',
          label: 'bio',
          defaultValue: 'I like testing kitchen sinks.',
        },
      ],
      run: (values) =>
        trpc.redis.hashProfile.save.mutate({
          favoriteColor: values('favoriteColor'),
          bio: values('bio'),
        }),
    }),
    exampleRow({
      title: 'Sorted sets: zIncrBy / zRange',
      description:
        'Add points to your leaderboard entry, then read the top 10.',
      inputs: [
        { id: 'points', label: 'points', type: 'number', defaultValue: '10' },
      ],
      run: async (values) => {
        await trpc.redis.leaderboard.addPoints.mutate({
          points: Number(values('points')) || 1,
        });
        return await trpc.redis.leaderboard.top.query();
      },
    }),
    exampleRow({
      title: 'Expiry: set({ expiration }) / expireTime',
      description:
        'Store a value that automatically disappears after N seconds.',
      inputs: [
        {
          id: 'value',
          label: 'value',
          defaultValue: 'self-destructing message',
        },
        {
          id: 'ttlSeconds',
          label: 'ttl (seconds)',
          type: 'number',
          defaultValue: '30',
        },
      ],
      run: async (values) => {
        await trpc.redis.withExpiry.set.mutate({
          value: values('value'),
          ttlSeconds: Number(values('ttlSeconds')) || 30,
        });
        return await trpc.redis.withExpiry.get.query();
      },
    }),
    exampleRow({
      title: 'Transactions: watch / multi / exec',
      description:
        'Optimistic-locking increment that avoids lost updates under a race.',
      buttonLabel: 'Run transaction',
      run: () => trpc.redis.transactionDemo.increment.mutate(),
    }),
    exampleRow({
      title: 'Global scope: redis.global',
      description:
        'A counter shared across every subreddit this app is installed in.',
      buttonLabel: 'Increment global',
      run: () => trpc.redis.globalScopeDemo.increment.mutate(),
    })
  );
};

const buildRealtime = (container: HTMLElement) => {
  container.append(
    sectionHeading('Realtime'),
    paragraph(
      'Managed pub/sub from @devvit/realtime: the server publishes, subscribed clients receive. Open this post in two tabs to see it live - also wired into the Rendering demo as multiplayer cursors.'
    )
  );

  const status = el('p', 'ks-status');
  status.textContent = 'Not connected.';
  const log = el('pre', 'ks-output');
  log.textContent = '(no messages yet)';
  container.append(status, log);

  const unsubscribeStatus = onCursorConnectionChange((connected) => {
    status.textContent = connected
      ? `Connected to channel ${context.postId}`
      : 'Disconnected.';
  });
  const unsubscribeMessages = onCursorMessage((msg) => {
    log.textContent = `${msg.username} moved to (${msg.x}, ${msg.y}) at ${new Date(msg.sentAt).toLocaleTimeString()}`;
  });

  container.append(
    exampleRow({
      title: 'realtime.send (server) -> connectRealtime (client)',
      description:
        'Broadcast a random cursor position to every other connected client.',
      buttonLabel: 'Broadcast random position',
      run: () =>
        trpc.realtime.broadcastCursor.mutate({
          x: Math.round(Math.random() * 1000),
          y: Math.round(Math.random() * 1000),
        }),
    })
  );

  return () => {
    unsubscribeStatus();
    unsubscribeMessages();
  };
};

const buildMedia = (container: HTMLElement) => {
  container.append(
    sectionHeading('Media'),
    paragraph(
      'Upload media from a public URL onto Reddit\u2019s CDN via @devvit/media.'
    ),
    exampleRow({
      title: 'media.upload',
      description:
        'Re-host an image from a URL, returning a mediaId + mediaUrl.',
      inputs: [
        {
          id: 'url',
          label: 'image url',
          defaultValue:
            'https://www.redditstatic.com/desktop2x/img/favicon/apple-icon-180x180.png',
        },
      ],
      run: (values) =>
        trpc.media.uploadFromUrl.mutate({ url: values('url'), type: 'image' }),
    })
  );
};

const buildNotifications = (container: HTMLElement) => {
  container.append(
    sectionHeading('Notifications'),
    paragraph(
      '@experimental - push notifications require Reddit approval to actually deliver; these calls run and return regardless.'
    ),
    exampleRow({
      title: 'optInCurrentUser / optOutCurrentUser',
      description:
        'Toggle whether you receive push notifications from this app.',
      buttonLabel: 'Opt in',
      run: () => trpc.notifications.optIn.mutate(),
    }),
    exampleRow({
      title: 'Opt out',
      description: 'The opposite of the above.',
      buttonLabel: 'Opt out',
      run: () => trpc.notifications.optOut.mutate(),
    }),
    exampleRow({
      title: 'isOptedIn',
      description: 'Check your current opt-in status.',
      run: () => trpc.notifications.checkOptedIn.query(),
    }),
    exampleRow({
      title: 'notifications.enqueue',
      description: 'Queue a test push notification to yourself.',
      inputs: [
        { id: 'title', label: 'title', defaultValue: 'Kitchen Sink' },
        {
          id: 'body',
          label: 'body',
          defaultValue: 'This is a test push notification!',
        },
      ],
      run: (values) =>
        trpc.notifications.sendTestPush.mutate({
          title: values('title'),
          body: values('body'),
        }),
    }),
    exampleRow({
      title: 'Game badge: request / dismiss / status',
      description:
        'Show or dismiss a badge on this app\u2019s post icon in-feed.',
      buttonLabel: 'Request badge',
      run: () => trpc.notifications.gameBadge.request.mutate(),
    }),
    exampleRow({
      title: 'Game badge status',
      description: 'Read whether a badge is currently active.',
      run: () => trpc.notifications.gameBadge.status.query(),
    })
  );
};

const buildPayments = (container: HTMLElement) => {
  container.append(
    sectionHeading('Payments'),
    paragraph(
      '@experimental - denominated in Reddit Gold; real purchases require payments eligibility approval. SKUs are defined in products.json.'
    ),
    exampleRow({
      title: 'payments.getProducts',
      description: 'List the SKUs configured for this app.',
      run: () => trpc.payments.listProducts.query(),
    }),
    exampleRow({
      title: 'purchase(sku) (client-side effect)',
      description: 'Kick off a real purchase flow for the "remove_ads" SKU.',
      buttonLabel: 'Purchase remove_ads',
      run: () => purchase('remove_ads'),
    }),
    exampleRow({
      title: 'payments.getOrders',
      description: 'List this install\u2019s order history.',
      run: () => trpc.payments.listOrders.query({ limit: 10 }),
    }),
    exampleRow({
      title: 'My entitlements (Redis, set by fulfillOrder)',
      description:
        'Read the entitlement flags granted by the server-side fulfillOrder handler.',
      run: () => trpc.payments.getMyEntitlements.query(),
    })
  );
};

const buildScheduler = (container: HTMLElement) => {
  container.append(
    sectionHeading('Scheduler'),
    paragraph('One-off and cron jobs from @devvit/scheduler.'),
    exampleRow({
      title: 'scheduler.runJob (one-off)',
      description: 'Schedule a reminder job that DMs you when it fires.',
      inputs: [
        {
          id: 'delaySeconds',
          label: 'delay (seconds)',
          type: 'number',
          defaultValue: '30',
        },
      ],
      run: (values) =>
        trpc.scheduler.scheduleReminder.mutate({
          delaySeconds: Number(values('delaySeconds')) || 30,
        }),
    }),
    exampleRow({
      title: 'scheduler.listJobs',
      description:
        'List every scheduled job, including the dailyReset cron task.',
      run: () => trpc.scheduler.listJobs.query(),
    }),
    exampleRow({
      title: 'scheduler.cancelJob',
      description:
        'Cancel a scheduled job by ID (copy an id from "listJobs" above).',
      inputs: [{ id: 'jobId', label: 'job id', defaultValue: '' }],
      run: (values) =>
        trpc.scheduler.cancelJob.mutate({ jobId: values('jobId') }),
    })
  );
};

const buildSettings = (container: HTMLElement) => {
  container.append(
    sectionHeading('Settings'),
    paragraph(
      'Moderator-configurable app settings from @devvit/settings, defined in devvit.json and edited on the app\u2019s install-settings page.'
    ),
    exampleRow({
      title: 'settings.get("welcomeMessage")',
      description: 'Read the moderator-configured welcome message.',
      run: () => trpc.settings.getWelcomeMessage.query(),
    })
  );
};

const buildCache = (container: HTMLElement) => {
  container.append(
    sectionHeading('Cache'),
    paragraph(
      'Redis-backed memoization from @devvit/cache. Run this twice quickly: the first call takes ~2s, the second returns instantly from cache.'
    ),
    exampleRow({
      title: 'cache(fn, { key, ttl })',
      description: 'Wraps a fake slow computation; cached for 30 seconds.',
      run: () => trpc.cache.cachedSlowValue.query(),
    })
  );
};

const buildClientEffects = (container: HTMLElement) => {
  container.append(
    sectionHeading('Client Effects'),
    paragraph(
      'UI-level functions from @devvit/web/client - no server round-trip involved.'
    ),
    exampleRow({
      title: 'showToast',
      description: 'Show a native toast message.',
      inputs: [
        {
          id: 'text',
          label: 'text',
          defaultValue: 'Hello from the kitchen sink!',
        },
      ],
      run: (values) => showToast(values('text')),
    }),
    exampleRow({
      title: 'showForm (client-invoked)',
      description:
        'Open a form modal directly from client code (no menu item needed).',
      buttonLabel: 'Open form',
      run: async () => {
        return await showForm({
          title: 'Client-invoked form',
          fields: [
            {
              type: 'string',
              name: 'favoriteSnack',
              label: 'Favorite snack',
              required: true,
            },
          ],
        });
      },
    }),
    exampleRow({
      title: 'showLoginPrompt',
      description: 'Open the Reddit login/signup prompt.',
      run: () => {
        showLoginPrompt();
        return { success: true };
      },
    }),
    exampleRow({
      title: 'showShareSheet + getShareData',
      description:
        'Open the native share sheet (or copy-to-clipboard fallback) for this post.',
      run: async () => {
        await showShareSheet({ title: 'Check out this Devvit app!' });
        return { shareData: getShareData() };
      },
    }),
    exampleRow({
      title: 'navigateTo',
      description: 'Navigate the top-level window to r/devvit.',
      run: () => {
        navigateTo('https://reddit.com/r/devvit');
        return { success: true };
      },
    }),
    exampleRow({
      title: 'requestExpandedMode',
      description:
        'Request the expanded (full-screen modal) presentation. No-op if already expanded, which is the case for game.html.',
      buttonLabel: 'Request expanded mode',
      run: (_values, event) => {
        requestExpandedMode(event, 'game');
        return { success: true };
      },
    }),
    exampleRow({
      title: 'exitExpandedMode',
      description: 'Return to the inline (feed) presentation.',
      buttonLabel: 'Exit expanded mode',
      run: (_values, event) => {
        exitExpandedMode(event);
        return { success: true };
      },
    })
  );
};

const buildRendering = (container: HTMLElement) => {
  container.append(
    sectionHeading('Rendering Demo (Phaser)'),
    paragraph(
      'The original Phaser scaffold, extended with a multiplayer cursor synced over Realtime - move your mouse over the canvas and open this post in a second tab to see it.'
    )
  );

  const gameContainer = el('div', 'ks-phaser-container');
  gameContainer.id = 'game-container';
  container.append(gameContainer);

  // Phaser is a large dependency - only instantiate it once this tab is opened.
  startPhaserGame('game-container');
};

export const categories: Category[] = [
  { id: 'reddit', label: 'Reddit API', build: buildReddit },
  { id: 'redis', label: 'Redis', build: buildRedis },
  { id: 'realtime', label: 'Realtime', build: buildRealtime },
  { id: 'media', label: 'Media', build: buildMedia },
  { id: 'notifications', label: 'Notifications', build: buildNotifications },
  { id: 'payments', label: 'Payments', build: buildPayments },
  { id: 'scheduler', label: 'Scheduler', build: buildScheduler },
  { id: 'settings', label: 'Settings', build: buildSettings },
  { id: 'cache', label: 'Cache', build: buildCache },
  { id: 'client', label: 'Client Effects', build: buildClientEffects },
  { id: 'rendering', label: 'Rendering Demo', build: buildRendering },
];
