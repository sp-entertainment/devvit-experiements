import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';

type ExampleFormValues = {
  message?: string;
};

type RichFormValues = {
  nickname?: string;
  bio?: string;
  favoriteNumber?: number;
  subscribeToUpdates?: boolean;
  favoriteColor?: string[];
  advancedMode?: boolean;
};

export const forms = new Hono();

// Devvit POSTs the submitted field values here as JSON once the user submits the
// "Example form" menu item's modal (src/server/routes/menu.ts).
forms.post('/example-submit', async (c) => {
  const { message } = await c.req.json<ExampleFormValues>();
  const trimmedMessage = typeof message === 'string' ? message.trim() : '';

  return c.json<UiResponse>(
    {
      showToast: trimmedMessage
        ? `Form says: ${trimmedMessage}`
        : 'Form submitted with no message',
    },
    200
  );
});

// Submit handler for the multi-field-type form demo.
forms.post('/rich-submit', async (c) => {
  const values = await c.req.json<RichFormValues>();

  return c.json<UiResponse>(
    {
      showToast: `Thanks ${values.nickname ?? 'friend'}! Favorite color: ${values.favoriteColor?.[0] ?? 'n/a'}, lucky number: ${values.favoriteNumber ?? 'n/a'}.`,
    },
    200
  );
});
