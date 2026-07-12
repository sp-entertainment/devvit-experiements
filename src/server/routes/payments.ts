import { Hono } from 'hono';
import type { PaymentHandlerResponse } from '@devvit/web/server';
import { context, redis } from '@devvit/web/server';

import {
  coinGrant,
  orderedSkus,
  paymentOrderSchema,
  paymentRecordSchema,
  redisInteger,
  refundedCoinBalance,
  samePayment,
  shouldRemoveDurableEntitlement,
  type PaymentRecord,
  type SupportedPaymentSku,
} from '../paymentRules';
import {
  isRedisTransactionConflict,
  redisTransactionConflictError,
  retryRedisTransaction,
} from '../redisTransactionRetry';

export const payments = new Hono();

const orderKey = (orderId: string): string => `payment:order:${orderId}`;
const entitlementKey = (userId: string): string => `entitlement:${userId}`;
const walletKey = (userId: string): string => `wallet:${userId}`;

const requirePaymentUserId = (): string => {
  if (!context.userId)
    throw new Error('Payment callback is missing its user ID');
  return context.userId;
};

const parseRecord = (raw: string | undefined): PaymentRecord | undefined =>
  raw ? paymentRecordSchema.parse(JSON.parse(raw)) : undefined;

const cleanupTransaction = async (
  transaction: Awaited<ReturnType<typeof redis.watch>>,
  multiStarted: boolean,
  error: unknown
): Promise<void> => {
  try {
    if (multiStarted) await transaction.discard();
    else await transaction.unwatch();
  } catch (cleanupError) {
    if (!isRedisTransactionConflict(error)) {
      console.debug(
        'Unable to clean up the payment Redis transaction:',
        cleanupError
      );
    }
  }
};

const assertMatchingRecord = (
  record: PaymentRecord,
  userId: string,
  products: SupportedPaymentSku[]
): void => {
  if (!samePayment(record, userId, products)) {
    throw new Error(
      `Payment order ${record.orderId} conflicts with its ledger`
    );
  }
};

const fulfillOrder = async (
  orderId: string,
  userId: string,
  products: SupportedPaymentSku[]
): Promise<{ success: boolean; reason?: string }> =>
  retryRedisTransaction(async () => {
    const ledgerKey = orderKey(orderId);
    const grantsKey = entitlementKey(userId);
    const coinsKey = walletKey(userId);
    const transaction = await redis.watch(ledgerKey, grantsKey, coinsKey);
    let multiStarted = false;
    try {
      const existing = parseRecord(await redis.get(ledgerKey));
      if (existing) {
        assertMatchingRecord(existing, userId, products);
        await transaction.unwatch();
        return existing.status === 'fulfilled'
          ? { success: true }
          : { success: false, reason: 'Order was already refunded' };
      }

      const currentCoins = redisInteger(await redis.hGet(coinsKey, 'coins'));
      const coins = currentCoins + coinGrant(products);
      const record: PaymentRecord = {
        orderId,
        userId,
        products,
        status: 'fulfilled',
      };

      await transaction.multi();
      multiStarted = true;
      if (products.includes('remove_ads')) {
        await transaction.hSet(grantsKey, { remove_ads: orderId });
      }
      if (coins !== currentCoins) {
        await transaction.hSet(coinsKey, { coins: String(coins) });
      }
      await transaction.set(ledgerKey, JSON.stringify(record));
      const result = await transaction.exec();
      if (result.length === 0) throw redisTransactionConflictError();
      return { success: true };
    } catch (error) {
      await cleanupTransaction(transaction, multiStarted, error);
      throw error;
    }
  });

const refundOrder = async (
  orderId: string,
  userId: string,
  requestedProducts: SupportedPaymentSku[]
): Promise<void> => {
  await retryRedisTransaction(async () => {
    const ledgerKey = orderKey(orderId);
    const grantsKey = entitlementKey(userId);
    const coinsKey = walletKey(userId);
    const transaction = await redis.watch(ledgerKey, grantsKey, coinsKey);
    let multiStarted = false;
    try {
      const existing = parseRecord(await redis.get(ledgerKey));
      if (existing) assertMatchingRecord(existing, userId, requestedProducts);
      if (existing?.status === 'refunded') {
        await transaction.unwatch();
        return;
      }

      const products = existing?.products ?? requestedProducts;
      const [durableOrderId, legacyCoinOrderId, storedCoins] =
        await Promise.all([
          redis.hGet(grantsKey, 'remove_ads'),
          redis.hGet(grantsKey, 'coin_pack_100'),
          redis.hGet(coinsKey, 'coins'),
        ]);
      const currentCoins = redisInteger(storedCoins);
      const coins = existing
        ? refundedCoinBalance(currentCoins, products)
        : currentCoins;
      const record: PaymentRecord = {
        orderId,
        userId,
        products,
        status: 'refunded',
      };

      await transaction.multi();
      multiStarted = true;
      if (shouldRemoveDurableEntitlement(durableOrderId, orderId)) {
        await transaction.hDel(grantsKey, ['remove_ads']);
      }
      if (legacyCoinOrderId === orderId) {
        await transaction.hDel(grantsKey, ['coin_pack_100']);
      }
      if (coins !== currentCoins) {
        await transaction.hSet(coinsKey, { coins: String(coins) });
      }
      await transaction.set(ledgerKey, JSON.stringify(record));
      const result = await transaction.exec();
      if (result.length === 0) throw redisTransactionConflictError();
    } catch (error) {
      await cleanupTransaction(transaction, multiStarted, error);
      throw error;
    }
  });
};

payments.post('/fulfill', async (c) => {
  const order = paymentOrderSchema.parse(await c.req.json());
  const result = await fulfillOrder(
    order.id,
    requirePaymentUserId(),
    orderedSkus(order)
  );
  return c.json<PaymentHandlerResponse>(
    result.success
      ? { success: true }
      : { success: false, reason: result.reason },
    200
  );
});

payments.post('/refund', async (c) => {
  const order = paymentOrderSchema.parse(await c.req.json());
  await refundOrder(order.id, requirePaymentUserId(), orderedSkus(order));
  return c.json<PaymentHandlerResponse>({ success: true }, 200);
});

payments.onError((error, c) => {
  console.error('Payment route failed:', error);
  return c.json<PaymentHandlerResponse>(
    { success: false, reason: 'Payment processing failed' },
    500
  );
});
