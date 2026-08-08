import { z } from 'zod';

export const adjustmentReasonSchema = z.enum(['DAMAGED', 'EXPIRED', 'RECOUNT', 'THEFT_SUSPECTED', 'OTHER']);

export const adjustStockSchema = z.object({
  productId: z.string().min(1),
  // For STORE_ADMIN: branchId is required and taken from this field.
  // For BRANCH_MANAGER: ignored — always derived from their JWT.
  branchId: z.string().min(1).optional(),
  quantity: z.number().int().refine((n) => n !== 0, { message: 'Quantity cannot be zero' }),
  reason: adjustmentReasonSchema,
  note: z.string().min(1).max(500),
});

export const listAdjustmentRequestsQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export const reviewAdjustmentRequestSchema = z.object({
  reviewNote: z.string().max(500).optional(),
});

export const rejectAdjustmentRequestSchema = z.object({
  reviewNote: z.string().min(1, 'A reason is required to reject a request').max(500),
});

export const transferStockSchema = z
  .object({
    productId: z.string().min(1),
    fromBranchId: z.string().min(1),
    toBranchId: z.string().min(1),
    quantity: z.number().int().positive(),
    note: z.string().max(500).optional(),
  })
  .refine((d) => d.fromBranchId !== d.toBranchId, {
    message: 'Source and destination branches must be different',
    path: ['toBranchId'],
  });

export const inventoryQuerySchema = z.object({
  // For STORE_ADMIN: required (which branch to inspect).
  // For BRANCH_MANAGER: ignored — always derived from JWT.
  branchId: z.string().optional(),
  search: z.string().optional(),
  categoryId: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export const movementsQuerySchema = z.object({
  branchId: z.string().optional(),
  productId: z.string().optional(),
  type: z
    .enum(['PURCHASE', 'SALE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'RETURN'])
    .optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export const lowStockQuerySchema = z.object({
  // For STORE_ADMIN: optional (filter by branch or show all).
  // For BRANCH_MANAGER: ignored — always derived from JWT.
  branchId: z.string().optional(),
});

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type TransferStockInput = z.infer<typeof transferStockSchema>;
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;
export type MovementsQuery = z.infer<typeof movementsQuerySchema>;
export type LowStockQuery = z.infer<typeof lowStockQuerySchema>;
export type ListAdjustmentRequestsQuery = z.infer<typeof listAdjustmentRequestsQuerySchema>;
export type ReviewAdjustmentRequestInput = z.infer<typeof reviewAdjustmentRequestSchema>;
export type RejectAdjustmentRequestInput = z.infer<typeof rejectAdjustmentRequestSchema>;
