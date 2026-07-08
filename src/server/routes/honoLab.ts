import { Hono } from 'hono';
import { z } from 'zod';

export const honoLab = new Hono();

const echoSchema = z.object({
  message: z.string().min(1).max(200),
});

honoLab.get('/ping', (c) =>
  c.json({
    ok: true,
    route: '/api/hono/ping',
    method: c.req.method,
  })
);

honoLab.get('/hello/:name', (c) => {
  const name = c.req.param('name');
  const shout = c.req.query('shout') === '1';
  const greeting = `Hello, ${name}`;

  return c.json({
    method: c.req.method,
    params: { name },
    query: { shout: c.req.query('shout') ?? null },
    greeting: shout ? greeting.toUpperCase() : greeting,
    userAgent: c.req.header('user-agent') ?? null,
  });
});

honoLab.post('/echo', async (c) => {
  const input = echoSchema.parse(await c.req.json());
  return c.json({
    method: c.req.method,
    validatedJson: input,
    contentType: c.req.header('content-type') ?? null,
  });
});

honoLab.get('/error', () => {
  throw new Error('Intentional Hono lab error');
});

honoLab.notFound((c) =>
  c.json(
    {
      ok: false,
      handledBy: 'honoLab.notFound',
      path: c.req.path,
    },
    404
  )
);

honoLab.onError((error, c) =>
  c.json(
    {
      ok: false,
      handledBy: 'honoLab.onError',
      message: error.message,
    },
    500
  )
);
