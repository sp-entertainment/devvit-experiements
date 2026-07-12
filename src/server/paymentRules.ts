import { z } from 'zod';

export const supportedPaymentSkuSchema = z.enum([
  'remove_ads',
  'coin_pack_100',
]);

export type SupportedPaymentSku = z.infer<typeof supportedPaymentSkuSchema>;

export const paymentOrderSchema = z
  .object({
    id: z.string().min(1).max(200),
    products: z
      .array(
        z
          .object({
            sku: supportedPaymentSkuSchema,
          })
          .passthrough()
      )
      .min(1)
      .max(10),
  })
  .passthrough();

export type PaymentOrder = z.infer<typeof paymentOrderSchema>;

export const paymentRecordSchema = z
  .object({
    orderId: z.string().min(1),
    userId: z.string().min(1),
    products: z.array(supportedPaymentSkuSchema).min(1),
    status: z.enum(['fulfilled', 'refunded']),
  })
  .strict();

export type PaymentRecord = z.infer<typeof paymentRecordSchema>;

export const orderedSkus = (order: PaymentOrder): SupportedPaymentSku[] =>
  order.products.map((product) => product.sku);

export const coinGrant = (products: SupportedPaymentSku[]): number =>
  products.filter((sku) => sku === 'coin_pack_100').length * 100;

export const refundedCoinBalance = (
  currentBalance: number,
  products: SupportedPaymentSku[]
): number => Math.max(0, currentBalance - coinGrant(products));

export const samePayment = (
  record: PaymentRecord,
  userId: string,
  products: SupportedPaymentSku[]
): boolean =>
  record.userId === userId &&
  record.products.length === products.length &&
  record.products.every((sku, index) => sku === products[index]);

export const shouldRemoveDurableEntitlement = (
  currentOrderId: string | undefined,
  refundedOrderId: string
): boolean => currentOrderId === refundedOrderId;

export const redisInteger = (value: string | undefined): number => {
  if (value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative Redis integer: ${value}`);
  }
  return parsed;
};
