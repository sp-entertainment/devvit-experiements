import {
  canRunAsUser,
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
import type { LogEntry } from '../../shared/logs';
import { trpc } from '../trpc';
import {
  el,
  errorMessage,
  exampleRow,
  paragraph,
  sectionHeading,
} from './ui';
import { startPhaserGame } from '../phaserGame';
import {
  startSharedCanvasDemo,
  type SharedCanvasTool,
} from '../sharedCanvasDemo';
import { startSmoothMovementDemo } from '../smoothMovementDemo';
import {
  onCanvasConnectionChange,
  onCursorConnectionChange,
  onCursorMessage,
} from '../realtimeChannel';
import { getClientLogs, subscribeClientLogs } from '../clientLogs';
import {
  CANVAS_COLORS,
  CANVAS_ERASER_MAX_RADIUS,
  CANVAS_ERASER_MIN_RADIUS,
} from '../../shared/realtime';

export type Category = {
  id: string;
  label: string;
  /** Returns an optional cleanup function, called when the user navigates to a
   * different tab (e.g. to unsubscribe from realtime listeners). */
  build: (container: HTMLElement) => void | (() => void);
};

const ensureCanRunAsUser = async (event: MouseEvent) => {
  const granted = await canRunAsUser(event);
  if (!granted)
    throw new Error('The viewer has not granted the requested User Action scopes.');
  return { granted };
};

const honoJson = async (path: string, init?: RequestInit) => {
  const response = await fetch(`/api/hono${path}`, init);
  return {
    ok: response.ok,
    status: response.status,
    body: await response.json(),
  };
};

const formatLogEntries = (logs: LogEntry[]): string => {
  if (!logs.length) return '(no logs captured yet)';

  return logs
    .map((entry) => {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      return `[${time}] ${entry.source} ${entry.level.toUpperCase()} ${entry.message}`;
    })
    .join('\n');
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
      title: 'Listing comparison',
      description:
        'Compare hot, new, rising, top/day, and controversial/day listings.',
      inputs: [
        { id: 'limit', label: 'limit', type: 'number', defaultValue: '3' },
      ],
      run: (values) =>
        trpc.reddit.listings.compare.query({
          limit: Number(values('limit')) || 3,
        }),
    }),
    exampleRow({
      title: 'Inspect current post + comments',
      description: 'Read this post plus a few comments beneath it.',
      inputs: [
        {
          id: 'commentsLimit',
          label: 'comments',
          type: 'number',
          defaultValue: '5',
        },
      ],
      run: (values) =>
        trpc.reddit.inspect.currentPost.query({
          commentsLimit: Number(values('commentsLimit')) || 5,
        }),
    }),
    exampleRow({
      title: 'Inspect post by ID',
      description: 'Fetch one post by its t3_ ID.',
      inputs: [
        { id: 'postId', label: 'post id', defaultValue: context.postId ?? '' },
      ],
      run: (values) =>
        trpc.reddit.inspect.post.query({ postId: values('postId') }),
    }),
    exampleRow({
      title: 'Inspect comment by ID',
      description: 'Fetch one comment by its t1_ ID.',
      inputs: [{ id: 'commentId', label: 'comment id', defaultValue: '' }],
      run: (values) =>
        trpc.reddit.inspect.comment.query({ commentId: values('commentId') }),
    }),
    exampleRow({
      title: 'Inspect user by username',
      description: 'Fetch a public user summary.',
      inputs: [
        {
          id: 'username',
          label: 'username',
          defaultValue: context.username ?? 'devvit',
        },
      ],
      run: (values) =>
        trpc.reddit.inspect.user.query({ username: values('username') }),
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
    }),
    exampleRow({
      title: 'canRunAsUser',
      description:
        'Check whether the viewer granted the configured User Action scopes.',
      run: (_values, event) => ensureCanRunAsUser(event),
    }),
    exampleRow({
      title: 'submitPost runAs USER',
      description: 'Create a normal self post as the viewer.',
      buttonLabel: 'Submit as user',
      inputs: [
        {
          id: 'title',
          label: 'title',
          defaultValue: '[Kitchen Sink] user-action test - delete me',
        },
        {
          id: 'text',
          label: 'text',
          defaultValue: 'Created from a Devvit User Actions toy.',
        },
      ],
      run: async (values, event) => ({
        permission: await ensureCanRunAsUser(event),
        post: await trpc.reddit.userActions.submitPostAsUser.mutate({
          title: values('title'),
          text: values('text'),
        }),
      }),
    }),
    exampleRow({
      title: 'submitComment runAs USER',
      description: 'Comment on the current post as the viewer.',
      buttonLabel: 'Comment as user',
      inputs: [
        {
          id: 'text',
          label: 'text',
          defaultValue: '[Kitchen Sink] user-action comment - delete me',
        },
      ],
      run: async (values, event) => ({
        permission: await ensureCanRunAsUser(event),
        comment: await trpc.reddit.userActions.commentOnCurrentPostAsUser.mutate(
          {
            text: values('text'),
          }
        ),
      }),
    }),
    exampleRow({
      title: 'subscribeToCurrentSubreddit',
      description: 'Subscribe to this subreddit via User Actions.',
      buttonLabel: 'Subscribe as user',
      run: async (_values, event) => ({
        permission: await ensureCanRunAsUser(event),
        result: await trpc.reddit.userActions.subscribeAsUser.mutate(),
      }),
    }),
    exampleRow({
      title: 'unsubscribeFromCurrentSubreddit',
      description:
        'Calls the SDK unsubscribe helper; Devvit exposes subscribe as the true User Action.',
      buttonLabel: 'Unsubscribe',
      run: async (_values, event) => ({
        permission: await ensureCanRunAsUser(event),
        result: await trpc.reddit.userActions.unsubscribeAsUser.mutate(),
      }),
    }),
    exampleRow({
      title: 'Flair templates',
      description: 'Read post and user flair templates for this subreddit.',
      run: () => trpc.reddit.flair.templates.query(),
    }),
    exampleRow({
      title: 'setPostFlair',
      description: 'Set text flair on a post, defaulting to this custom post.',
      inputs: [
        { id: 'postId', label: 'post id', defaultValue: context.postId ?? '' },
        { id: 'text', label: 'text', defaultValue: 'Kitchen Sink' },
      ],
      run: (values) =>
        trpc.reddit.flair.setPost.mutate({
          postId: values('postId'),
          text: values('text'),
        }),
    }),
    exampleRow({
      title: 'removePostFlair',
      description: 'Remove post flair from a post.',
      inputs: [
        { id: 'postId', label: 'post id', defaultValue: context.postId ?? '' },
      ],
      run: (values) =>
        trpc.reddit.flair.removePost.mutate({ postId: values('postId') }),
    }),
    exampleRow({
      title: 'Wiki sandbox: read',
      description: 'Read the fixed devvit-kitchen-sink-sandbox wiki page.',
      run: () => trpc.reddit.wiki.readSandbox.query(),
    }),
    exampleRow({
      title: 'Wiki sandbox: update/create',
      description: 'Create or update the fixed sandbox wiki page.',
      inputs: [
        {
          id: 'markdown',
          label: 'markdown',
          defaultValue: '# Devvit Kitchen Sink Sandbox\n\nUpdated from the app.',
        },
      ],
      run: (values) =>
        trpc.reddit.wiki.updateSandbox.mutate({
          markdown: values('markdown'),
        }),
    }),
    exampleRow({
      title: 'Wiki sandbox: revisions',
      description: 'Read recent revisions for the sandbox wiki page.',
      run: () => trpc.reddit.wiki.revisions.query(),
    }),
    exampleRow({
      title: 'Moderation snapshot',
      description: 'Read rules, mod queue, and reports without taking action.',
      inputs: [
        { id: 'limit', label: 'limit', type: 'number', defaultValue: '5' },
      ],
      run: (values) =>
        trpc.reddit.moderation.snapshot.query({
          limit: Number(values('limit')) || 5,
        }),
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

const buildLeaderboard = (container: HTMLElement) => {
  let active = true;
  let refreshTimer: number | undefined;

  const toolbar = el('div', 'ks-log-toolbar');
  const refreshButton = el('button', 'ks-button');
  refreshButton.textContent = 'Refresh';
  toolbar.append(refreshButton);

  const status = el('p', 'ks-status');
  status.textContent = 'Loading leaderboard...';

  const table = el('table', 'ks-score-table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const text of ['Rank', 'User', 'Score']) {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.append(th);
  }
  thead.append(headerRow);
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);

  const refresh = async (showErrorToast: boolean) => {
    refreshButton.disabled = true;
    try {
      const scores = await trpc.redis.leaderboard.all.query();
      if (!active) return;
      tbody.innerHTML = '';
      if (!scores.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 3;
        cell.textContent = 'No scores yet.';
        row.append(cell);
        tbody.append(row);
      }
      scores.forEach(({ member, score }, index) => {
        const row = document.createElement('tr');
        for (const text of [String(index + 1), member, String(score)]) {
          const cell = document.createElement('td');
          cell.textContent = text;
          row.append(cell);
        }
        tbody.append(row);
      });
      status.classList.remove('ks-output-error');
      status.textContent = `${scores.length} score(s) loaded.`;
    } catch (error) {
      if (!active) return;
      if (showErrorToast) {
        status.classList.add('ks-output-error');
        status.textContent = `Error: ${errorMessage(error)}`;
        showToast(`Error: ${errorMessage(error)}`);
      } else {
        console.warn('Automatic leaderboard refresh failed:', error);
      }
    } finally {
      if (active) refreshButton.disabled = false;
    }
  };

  const queueRefresh = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined;
      void refresh(false);
    }, 250);
  };

  const queueRefreshWhenVisible = () => {
    if (document.visibilityState === 'visible') queueRefresh();
  };

  refreshButton.addEventListener('click', () => {
    void refresh(true);
  });
  document.addEventListener('visibilitychange', queueRefreshWhenVisible);
  window.addEventListener('focus', queueRefresh);
  window.addEventListener('pageshow', queueRefresh);

  container.append(
    sectionHeading('Leaderboard'),
    paragraph('All stored scores for this post, highest first.'),
    toolbar,
    status,
    table,
    exampleRow({
      title: 'All scores JSON',
      description: 'Debug view of the raw leaderboard response.',
      buttonLabel: 'Refresh JSON',
      run: () => trpc.redis.leaderboard.all.query(),
    })
  );

  void refresh(false);

  return () => {
    active = false;
    window.clearTimeout(refreshTimer);
    document.removeEventListener('visibilitychange', queueRefreshWhenVisible);
    window.removeEventListener('focus', queueRefresh);
    window.removeEventListener('pageshow', queueRefresh);
  };
};

const buildMyHighScore = (container: HTMLElement) => {
  container.append(
    sectionHeading('My High Score'),
    paragraph('Get or overwrite your score in this post leaderboard.'),
    exampleRow({
      title: 'Get my score',
      description: 'Read the current logged-in player score.',
      buttonLabel: 'Read',
      run: () => trpc.redis.leaderboard.mine.get.query(),
    }),
    exampleRow({
      title: 'Set my score',
      description: 'Overwrite the current logged-in player score.',
      buttonLabel: 'Set',
      inputs: [{ id: 'score', label: 'score', type: 'number', defaultValue: '0' }],
      run: (values) =>
        trpc.redis.leaderboard.mine.set.mutate({
          score: Number(values('score')),
        }),
    })
  );
};

const buildRedisDebug = (container: HTMLElement) => {
  container.append(
    sectionHeading('Redis Debug'),
    paragraph(
      'Delete known Redis keys for this post. This does not scan or flush the app store.'
    ),
    exampleRow({
      title: 'Clear Smooth Movement',
      description:
        'Deletes the current versioned ball-state hash for this post.',
      buttonLabel: 'Clear balls',
      run: () => trpc.redis.debug.clearSmoothMovement.mutate(),
    }),
    exampleRow({
      title: 'Clear Shared Canvas',
      description: 'Deletes the current shared canvas hash for this post.',
      buttonLabel: 'Clear canvas',
      run: () => trpc.redis.debug.clearSharedCanvas.mutate(),
    }),
    exampleRow({
      title: 'Clear Redis examples',
      description:
        'Deletes the counter, your profile row, leaderboard, expiring value, and transaction counter for this post.',
      buttonLabel: 'Clear examples',
      run: () => trpc.redis.debug.clearRedisExamples.mutate(),
    }),
    exampleRow({
      title: 'Clear all known current-post keys',
      description:
        'Deletes Smooth Movement, Shared Canvas, and the Redis example keys for this post.',
      buttonLabel: 'Clear all',
      run: () => trpc.redis.debug.clearCurrentPost.mutate(),
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

const buildClientLogs = (container: HTMLElement) => {
  container.append(
    sectionHeading('Client Logs'),
    paragraph('Current expanded-view console output captured in this iframe.')
  );

  const toolbar = el('div', 'ks-log-toolbar');
  const copyButton = el('button', 'ks-button');
  copyButton.textContent = 'Copy all';
  const wrapLabel = el('label', 'ks-log-toggle');
  const wrapInput = document.createElement('input');
  wrapInput.type = 'checkbox';
  const wrapText = el('span');
  wrapText.textContent = 'Line wrap';
  wrapLabel.append(wrapInput, wrapText);
  toolbar.append(copyButton, wrapLabel);

  const output = el('pre', 'ks-output ks-log-output ks-log-nowrap');
  const render = () => {
    output.textContent = formatLogEntries(getClientLogs());
  };

  copyButton.addEventListener('click', () => {
    void navigator.clipboard
      .writeText(formatLogEntries(getClientLogs()))
      .then(() => showToast('Client logs copied.'))
      .catch((error: unknown) => showToast(`Error: ${errorMessage(error)}`));
  });
  wrapInput.addEventListener('change', () => {
    output.classList.toggle('ks-log-nowrap', !wrapInput.checked);
  });

  render();
  container.append(toolbar, output);
  return subscribeClientLogs(render);
};

const buildServerLogs = (container: HTMLElement) => {
  container.append(
    sectionHeading('Server Logs'),
    paragraph(
      'Official Devvit logs stream through the CLI. This tab also tails this app\u2019s captured server console output.'
    )
  );

  const command = el('pre', 'ks-output ks-log-command');
  command.textContent = `devvit logs ${context.subredditName} ${context.appSlug} --since 15m --verbose`;

  const toolbar = el('div', 'ks-log-toolbar');
  const limitLabel = el('label', 'ks-log-limit');
  const limitText = el('span');
  limitText.textContent = 'Current trailing limit: loading';
  const limitInput = document.createElement('input');
  limitInput.type = 'number';
  limitInput.min = '1';
  limitInput.max = '5000';
  limitInput.step = '1';
  limitInput.value = '500';
  limitLabel.append(limitText, limitInput);

  const applyButton = el('button', 'ks-button');
  applyButton.textContent = 'Apply';
  const refreshButton = el('button', 'ks-button');
  refreshButton.textContent = 'Refresh';
  const clearButton = el('button', 'ks-button');
  clearButton.textContent = 'Clear';
  toolbar.append(limitLabel, applyButton, refreshButton, clearButton);

  const status = el('p', 'ks-status');
  status.textContent = 'Loading server logs...';
  const output = el('pre', 'ks-output ks-log-output');
  output.textContent = 'Loading...';

  container.append(command, toolbar, status, output);

  let active = true;

  const setBusy = (busy: boolean) => {
    applyButton.disabled = busy;
    refreshButton.disabled = busy;
    clearButton.disabled = busy;
  };

  const renderLogs = (result: { limit: number; logs: LogEntry[] }) => {
    limitText.textContent = `Current trailing limit: ${result.limit}`;
    limitInput.value = String(result.limit);
    output.classList.remove('ks-output-error');
    output.textContent = formatLogEntries(result.logs);
    status.textContent = `${result.logs.length} server log(s) loaded.`;
  };

  const refresh = async () => {
    try {
      const result = await trpc.logs.listServerLogs.query();
      if (active) renderLogs(result);
    } catch (error) {
      if (!active) return;
      output.classList.add('ks-output-error');
      output.textContent = `Error: ${errorMessage(error)}`;
      status.textContent = 'Failed to load server logs.';
    }
  };

  applyButton.addEventListener('click', () => {
    void (async () => {
      setBusy(true);
      try {
        const limit = Number(limitInput.value);
        if (!Number.isInteger(limit) || limit < 1 || limit > 5000)
          throw new Error('Limit must be an integer from 1 to 5000.');
        await trpc.logs.setServerLogLimit.mutate({ limit });
        await refresh();
        showToast('Server log limit updated.');
      } catch (error) {
        showToast(`Error: ${errorMessage(error)}`);
      } finally {
        setBusy(false);
      }
    })();
  });

  refreshButton.addEventListener('click', () => {
    void refresh();
  });

  clearButton.addEventListener('click', () => {
    void (async () => {
      setBusy(true);
      try {
        await trpc.logs.clearServerLogs.mutate();
        await refresh();
        showToast('Server logs cleared.');
      } catch (error) {
        showToast(`Error: ${errorMessage(error)}`);
      } finally {
        setBusy(false);
      }
    })();
  });

  void refresh();
  const interval = window.setInterval(() => {
    void refresh();
  }, 5000);

  return () => {
    active = false;
    window.clearInterval(interval);
  };
};

const buildDevvitEvents = (container: HTMLElement) => {
  container.append(
    sectionHeading('Devvit Events'),
    paragraph(
      'Fixed-contract menu and trigger callbacks, registered in devvit.json and handled by Hono.'
    ),
    exampleRow({
      title: 'Event counters + last summaries',
      description:
        'Read Redis-backed counts for post/comment menu items and trigger callbacks.',
      run: () => trpc.devvitEvents.snapshot.query(),
    })
  );
};

const buildHonoLab = (container: HTMLElement) => {
  container.append(
    sectionHeading('Hono Lab'),
    paragraph(
      'Plain Hono routes mounted outside tRPC: params, query, JSON body parsing, notFound, and onError.'
    ),
    exampleRow({
      title: 'GET /api/hono/ping',
      description: 'Smallest possible route.',
      run: () => honoJson('/ping'),
    }),
    exampleRow({
      title: 'GET /api/hono/hello/:name',
      description: 'Route params, query params, and request headers.',
      inputs: [
        { id: 'name', label: 'name', defaultValue: context.username ?? 'devvit' },
        { id: 'shout', label: 'shout 1/0', defaultValue: '1' },
      ],
      run: (values) =>
        honoJson(
          `/hello/${encodeURIComponent(values('name'))}?shout=${encodeURIComponent(values('shout'))}`
        ),
    }),
    exampleRow({
      title: 'POST /api/hono/echo',
      description: 'Parse and validate a JSON body with Zod.',
      inputs: [
        {
          id: 'message',
          label: 'message',
          defaultValue: 'Hello from Hono',
        },
      ],
      run: (values) =>
        honoJson('/echo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: values('message') }),
        }),
    }),
    exampleRow({
      title: 'Hono notFound',
      description: 'Hit an unregistered Hono route.',
      run: () => honoJson('/missing-route'),
    }),
    exampleRow({
      title: 'Hono onError',
      description: 'Hit a route that intentionally throws.',
      run: () => honoJson('/error'),
    })
  );
};

const buildDashboard = (container: HTMLElement) => {
  container.append(
    sectionHeading('Dashboard'),
    paragraph(
      'One read-only snapshot assembled in the client from existing examples.'
    ),
    exampleRow({
      title: 'Kitchen sink snapshot',
      description:
        'Current user, subreddit, listings, Devvit events, scheduler jobs, and settings.',
      run: async () => {
        const [me, subreddit, listings, devvitEvents, schedulerJobs, settings] =
          await Promise.all([
            trpc.reddit.getMe.query(),
            trpc.reddit.getSubredditInfo.query(),
            trpc.reddit.listings.compare.query({ limit: 3 }),
            trpc.devvitEvents.snapshot.query(),
            trpc.scheduler.listJobs.query(),
            trpc.settings.getWelcomeMessage.query(),
          ]);

        return {
          me,
          subreddit,
          listings,
          devvitEvents,
          schedulerJobs,
          settings,
        };
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

const buildSmoothMovement = (container: HTMLElement) => {
  container.append(
    sectionHeading('Smooth Movement (Realtime + Phaser)'),
    paragraph(
      'Each Reddit user owns one colored ball. Redis stores the authoritative positions, Realtime broadcasts point-to-point moves, and Phaser tweens the render.'
    )
  );

  const gameContainer = el('div', 'ks-phaser-container');
  gameContainer.id = 'smooth-movement-container';
  container.append(gameContainer);

  startSmoothMovementDemo('smooth-movement-container');
};

const buildSharedCanvas = (container: HTMLElement) => {
  let tool: SharedCanvasTool = 'pixel';
  let color = CANVAS_COLORS[5] ?? '#38bdf8';
  let eraserRadius = 32;

  container.append(
    sectionHeading('Shared Canvas'),
    paragraph(
      'Dedicated realtime channel example: click to add pixels, click in Text mode to type words, or erase anything on the shared post canvas.'
    )
  );

  const toolbar = el('div', 'ks-canvas-toolbar');
  const toolButtons = new Map<SharedCanvasTool, HTMLButtonElement>();
  const colorButtons: HTMLButtonElement[] = [];

  const updateControls = () => {
    for (const [buttonTool, button] of toolButtons) {
      button.classList.toggle('ks-tool-active', buttonTool === tool);
    }
    for (const button of colorButtons) {
      button.classList.toggle('ks-swatch-active', button.dataset.color === color);
    }
  };

  const addToolButton = (buttonTool: SharedCanvasTool, label: string) => {
    const button = el('button', 'ks-tool-button');
    button.textContent = label;
    button.addEventListener('click', () => {
      tool = buttonTool;
      updateControls();
    });
    toolButtons.set(buttonTool, button);
    toolbar.append(button);
  };

  addToolButton('pixel', 'Pixel');
  addToolButton('text', 'Text');
  addToolButton('erase', 'Erase');

  const colorGroup = el('div', 'ks-swatch-group');
  for (const swatch of CANVAS_COLORS) {
    const button = el('button', 'ks-swatch');
    button.style.backgroundColor = swatch;
    button.dataset.color = swatch;
    button.ariaLabel = `Use ${swatch}`;
    button.addEventListener('click', () => {
      color = swatch;
      updateControls();
    });
    colorButtons.push(button);
    colorGroup.append(button);
  }
  toolbar.append(colorGroup);

  const eraserLabel = el('label', 'ks-canvas-size');
  const eraserText = el('span');
  eraserText.textContent = 'Size';
  const eraserInput = document.createElement('input');
  eraserInput.type = 'range';
  eraserInput.min = String(CANVAS_ERASER_MIN_RADIUS);
  eraserInput.max = String(CANVAS_ERASER_MAX_RADIUS);
  eraserInput.step = '8';
  eraserInput.value = String(eraserRadius);
  eraserInput.addEventListener('input', () => {
    eraserRadius = Number(eraserInput.value);
  });
  eraserLabel.append(eraserText, eraserInput);
  toolbar.append(eraserLabel);

  const status = el('p', 'ks-canvas-status');
  status.textContent = 'Connecting...';
  const channelStatus = el('p', 'ks-canvas-channel-status');
  const channelName = context.postId;
  channelStatus.textContent = `Canvas channel ${channelName}: connecting`;

  const gameContainer = el('div', 'ks-phaser-container');
  gameContainer.id = 'shared-canvas-container';

  updateControls();
  container.append(toolbar, channelStatus, status, gameContainer);

  const unsubscribeChannelStatus = onCanvasConnectionChange((connected) => {
    channelStatus.textContent = `Canvas channel ${channelName}: ${
      connected ? 'connected' : 'disconnected'
    }`;
  });
  startSharedCanvasDemo('shared-canvas-container', {
    getTool: () => tool,
    getColor: () => color,
    getEraserRadius: () => eraserRadius,
    setStatus: (text) => {
      status.textContent = text;
    },
  });

  return unsubscribeChannelStatus;
};

export const categories: Category[] = [
  { id: 'reddit', label: 'Reddit API', build: buildReddit },
  { id: 'redis', label: 'Redis', build: buildRedis },
  { id: 'leaderboard', label: 'Leaderboard', build: buildLeaderboard },
  { id: 'my-high-score', label: 'My High Score', build: buildMyHighScore },
  { id: 'redis-debug', label: 'Redis Debug', build: buildRedisDebug },
  { id: 'realtime', label: 'Realtime', build: buildRealtime },
  { id: 'media', label: 'Media', build: buildMedia },
  { id: 'notifications', label: 'Notifications', build: buildNotifications },
  { id: 'payments', label: 'Payments', build: buildPayments },
  { id: 'scheduler', label: 'Scheduler', build: buildScheduler },
  { id: 'settings', label: 'Settings', build: buildSettings },
  { id: 'cache', label: 'Cache', build: buildCache },
  { id: 'events', label: 'Devvit Events', build: buildDevvitEvents },
  { id: 'hono', label: 'Hono Lab', build: buildHonoLab },
  { id: 'dashboard', label: 'Dashboard', build: buildDashboard },
  { id: 'client', label: 'Client Effects', build: buildClientEffects },
  { id: 'client-logs', label: 'Client Logs', build: buildClientLogs },
  { id: 'server-logs', label: 'Server Logs', build: buildServerLogs },
  { id: 'rendering', label: 'Rendering Demo', build: buildRendering },
  { id: 'smooth-movement', label: 'Smooth Movement', build: buildSmoothMovement },
  { id: 'shared-canvas', label: 'Shared Canvas', build: buildSharedCanvas },
];
