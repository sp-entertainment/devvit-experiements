import { z } from 'zod';
import { context, payments, redis } from '@devvit/web/server';
import { redisInteger } from '../paymentRules';
import {
  authenticatedProcedure,
  moderatorProcedure,
  publicProcedure,
  router,
} from '../trpc';

// NOTE: Payments are an @experimental Devvit capability denominated in Reddit Gold.
// These read-only procedures work in the sandbox immediately, but actually charging
// real users (via the client-side `purchase()` call) requires developer payments
// eligibility approval from Reddit. See `products.json` for the SKUs these read.

export const paymentsRouter = router({
  // payments.getProducts(): list the SKUs configured in this app's products.json.
  listProducts: publicProcedure.query(async () => {
    const { products } = await payments.getProducts();
    return products;
  }),

  // payments.getOrders(): query this installation's order history (requires `limit`).
  listOrders: moderatorProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const { orders } = await payments.getOrders({ limit: input.limit });
      return orders;
    }),

  // Reads the Redis entitlement flags granted by src/server/routes/payments.ts's
  // `fulfillOrder` handler for the calling user.
  getMyEntitlements: authenticatedProcedure.query(async () => {
    const [entitlements, wallet] = await Promise.all([
      redis.hGetAll(`entitlement:${context.userId}`),
      redis.hGetAll(`wallet:${context.userId}`),
    ]);
    return { entitlements, coinBalance: redisInteger(wallet.coins) };
  }),
});
