import { z } from 'zod';

// Accept YYYY-MM-DD or full ISO 8601 — the service parses both with new Date()
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?(\+[\d:]+)?)?$/, 'Use YYYY-MM-DD or ISO 8601')
  .optional();

export const baseDateRangeSchema = z.object({
  startDate: dateString,
  endDate: dateString,
  branchId: z.string().min(1).optional(),
  format: z.enum(['json', 'csv']).optional().default('json'),
});

export const salesSummarySchema = baseDateRangeSchema.extend({
  groupBy: z.enum(['day', 'week', 'month']).optional().default('day'),
});

export const salesByProductSchema = baseDateRangeSchema.extend({
  limit: z.coerce.number().int().positive().max(100).optional().default(10),
});

export const expensesSummarySchema = baseDateRangeSchema.extend({
  groupBy:    z.enum(['day', 'week', 'month']).optional().default('month'),
  categoryId: z.string().cuid().optional(),
});

export type BaseDateRangeQuery    = z.infer<typeof baseDateRangeSchema>;
export type SalesSummaryQuery     = z.infer<typeof salesSummarySchema>;
export type SalesByProductQuery   = z.infer<typeof salesByProductSchema>;
export type ExpensesSummaryQuery  = z.infer<typeof expensesSummarySchema>;
