import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';

export const menu = new Hono();

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
