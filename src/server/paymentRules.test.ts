import assert from 'node:assert/strict';
import test from 'node:test';

import {
  coinGrant,
  paymentOrderSchema,
  refundedCoinBalance,
  samePayment,
  shouldRemoveDurableEntitlement,
  type PaymentRecord,
  type SupportedPaymentSku,
} from './paymentRules.js';

void test('validates only configured products and bounded orders', () => {
  assert.equal(
    paymentOrderSchema.parse({
      id: 'order-1',
      products: [{ sku: 'remove_ads' }, { sku: 'coin_pack_100' }],
    }).products.length,
    2
  );
  assert.throws(() =>
    paymentOrderSchema.parse({
      id: 'order-2',
      products: [{ sku: 'unknown' }],
    })
  );
});

void test('calculates repeatable consumable grants and bounded refunds', () => {
  const products: SupportedPaymentSku[] = [
    'coin_pack_100',
    'remove_ads',
    'coin_pack_100',
  ];
  assert.equal(coinGrant(products), 200);
  assert.equal(refundedCoinBalance(350, products), 150);
  assert.equal(refundedCoinBalance(50, products), 0);
});

void test('matches idempotency records to both user and ordered products', () => {
  const record: PaymentRecord = {
    orderId: 'order-1',
    userId: 't2_buyer',
    products: ['remove_ads'],
    status: 'fulfilled',
  };
  assert.equal(samePayment(record, 't2_buyer', ['remove_ads']), true);
  assert.equal(samePayment(record, 't2_other', ['remove_ads']), false);
  assert.equal(samePayment(record, 't2_buyer', ['coin_pack_100']), false);
});

void test('refund removes a durable grant only when that order still owns it', () => {
  assert.equal(shouldRemoveDurableEntitlement('order-1', 'order-1'), true);
  assert.equal(shouldRemoveDurableEntitlement('newer-order', 'order-1'), false);
});
