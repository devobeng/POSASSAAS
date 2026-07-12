import { z } from 'zod';

export const orderItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const paymentInputSchema = z.object({
  method: z.enum(['CASH', 'CARD', 'MOBILE_MONEY', 'PAYSTACK']),
  amount: z.number().positive(),
});

export const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1, 'Order must have at least one item'),
  discount: z.number().min(0).optional().default(0),
  payments: z.array(paymentInputSchema).min(1, 'At least one payment is required'),
  // Offline-first fields — all optional for online orders
  clientOrderId: z.string().uuid().optional(),
  createdAtClient: z.string().datetime({ offset: true }).optional(),
  offlineReference: z.string().max(100).optional(),
});

// Accepts YYYY-MM-DD or full ISO 8601 — service coerces both with new Date()
const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?([+-][\d:]+)?)?$/, 'Use YYYY-MM-DD or ISO 8601')
  .optional();

export const orderListQuerySchema = z.object({
  branchId: z.string().optional(),
  cashierId: z.string().optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED', 'REFUNDED']).optional(),
  startDate: dateParam,
  endDate: dateParam,
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
