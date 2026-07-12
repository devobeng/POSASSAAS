import { z } from 'zod';
import { createOrderSchema } from '../orders/orders.schema';

// Each order in a batch must carry a clientOrderId (the device-generated UUID).
const offlineOrderSchema = createOrderSchema.extend({
  clientOrderId: z.string().uuid('clientOrderId must be a valid UUID'),
});

export const batchSyncSchema = z.object({
  orders: z
    .array(offlineOrderSchema)
    .min(1, 'Provide at least one order')
    .max(50, 'Batch size limit is 50 orders'),
});

export const catalogQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  branchId: z.string().optional(),
});

export type BatchSyncInput = z.infer<typeof batchSyncSchema>;
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
