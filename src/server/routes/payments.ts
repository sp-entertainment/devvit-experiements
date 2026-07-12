import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';

export const payments = new Hono();

// Minimal shape of the `Order` Devvit posts to the fulfill/refund endpoints
// (see `@devvit/payments/shared`'s `Order` type for the full version).
type OrderRequest = {
  id: string;
  products: { sku: string }[];
};

type PaymentHandlerResponse =
  { success: true } | { success: false; reason?: string };

const entitlementKey = () => `entitlement:${context.userId ?? 'unknown'}`;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// devvit.json `payments.endpoints.fulfillOrder` (required): called once a purchase is
// paid for. Grants the buyer an entitlement flag in Redis for each SKU purchased -
// swap this for whatever "unlock" logic your app needs (removing ads, unlocking
// content, crediting in-game currency, etc.).
payments.post('/fulfill', async (c) => {
  const order = await c.req.json<OrderRequest>();

  try {
    for (const product of order.products) {
      await redis.hSet(entitlementKey(), { [product.sku]: order.id });
    }
    return c.json<PaymentHandlerResponse>({ success: true }, 200);
  } catch (error) {
    console.error(`Failed to fulfill order ${order.id}:`, error);
    return c.json<PaymentHandlerResponse>(
      { success: false, reason: 'fulfillment failed' },
      200
    );
  }
});

// devvit.json `payments.endpoints.refundOrder` (optional): called if a purchase is
// refunded - revoke whatever `fulfillOrder` granted.
payments.post('/refund', async (c) => {
  const order = await c.req.json<OrderRequest>();

  for (const product of order.products) {
    await redis.hDel(entitlementKey(), [product.sku]);
  }

  return c.json<PaymentHandlerResponse>({ success: true }, 200);
});

payments.onError((error, c) => {
  console.error('Payment route failed:', error);
  return c.json<PaymentHandlerResponse>(
    { success: false, reason: errorMessage(error) },
    200
  );
});
