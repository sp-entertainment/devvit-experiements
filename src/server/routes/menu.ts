import { Hono } from 'hono';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { context, reddit } from '@devvit/web/server';
import { createPost } from '../core/post';
import { recordMenu } from '../core/devvitEvents';
import { getAgentFixturePostId, setAgentFixturePostId } from '../routers/agent';

export const menu = new Hono();

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const isPostId = (value: string): value is `t3_${string}` =>
  value.startsWith('t3_');

// Simplest possible menu item: create a new custom post in the subreddit the app is
// installed in via `reddit.submitCustomPost` (see src/server/core/post.ts).
menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();

    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>(
      {
        showToast: 'Failed to create post',
      },
      400
    );
  }
});

// Stores a stable, reusable post for browser agents. It intentionally stays in the
// learning app's test subreddit so Playtest updates can be checked against one URL.
menu.post('/agent-fixture', async (c) => {
  try {
    const existingId = await getAgentFixturePostId();
    if (existingId && isPostId(existingId)) {
      try {
        await reddit.getPostById(existingId);
        return c.json<UiResponse>(
          {
            navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${existingId}`,
          },
          200
        );
      } catch {
        // The stored post was deleted; create a fresh fixture below.
      }
    }
    const post = await createPost('[Agent Fixture] Devvit Kitchen Sink');
    await setAgentFixturePostId(post.id);
    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error ensuring agent fixture: ${error}`);
    return c.json<UiResponse>(
      { showToast: 'Failed to create agent fixture' },
      400
    );
  }
});

// Menu items can also open a form instead of navigating. The `name` here must match a
// key under `forms` in devvit.json - Devvit's own webview shell renders the field
// definitions below, then POSTs the submitted values to that form's configured
// endpoint (src/server/routes/forms.ts).
menu.post('/example-form', (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'exampleForm',
        form: {
          title: 'Example form',
          description: 'A minimal single-field form.',
          fields: [
            {
              type: 'string',
              name: 'message',
              label: 'Message',
              helpText: 'Shown back to you as a toast on submit.',
            },
          ],
        },
      },
    },
    200
  );
});

// A second form demonstrating every basic field type together: string, paragraph,
// number, boolean, select, and a group that nests fields visually.
menu.post('/rich-form', (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'richForm',
        form: {
          title: 'Rich form field types',
          acceptLabel: 'Submit',
          fields: [
            {
              type: 'string',
              name: 'nickname',
              label: 'Nickname',
              required: true,
            },
            { type: 'paragraph', name: 'bio', label: 'Short bio' },
            {
              type: 'number',
              name: 'favoriteNumber',
              label: 'Favorite number',
              defaultValue: 7,
            },
            {
              type: 'boolean',
              name: 'subscribeToUpdates',
              label: 'Subscribe to updates',
            },
            {
              type: 'select',
              name: 'favoriteColor',
              label: 'Favorite color',
              options: [
                { label: 'Red', value: 'red' },
                { label: 'Green', value: 'green' },
                { label: 'Blue', value: 'blue' },
              ],
            },
            {
              type: 'group',
              label: 'Advanced (grouped fields)',
              fields: [
                {
                  type: 'boolean',
                  name: 'advancedMode',
                  label: 'Enable advanced mode',
                },
              ],
            },
          ],
        },
      },
    },
    200
  );
});

menu.post('/post-context', async (c) => {
  const input = await c.req.json<MenuItemRequest>();
  await recordMenu('post', {
    location: input.location,
    targetId: input.targetId,
  });

  return c.json<UiResponse>(
    {
      showToast: `Post menu fired for ${input.targetId}`,
    },
    200
  );
});

menu.post('/comment-context', async (c) => {
  const input = await c.req.json<MenuItemRequest>();
  await recordMenu('comment', {
    location: input.location,
    targetId: input.targetId,
  });

  return c.json<UiResponse>(
    {
      showToast: `Comment menu fired for ${input.targetId}`,
    },
    200
  );
});

menu.onError((error, c) => {
  console.error('Menu route failed:', error);
  return c.json<UiResponse>(
    { showToast: `Menu error: ${errorMessage(error)}` },
    200
  );
});
