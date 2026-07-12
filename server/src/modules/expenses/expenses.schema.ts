import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format');

const expenseBaseSchema = z.object({
  categoryId:        z.string().cuid(),
  branchId:          z.string().cuid().optional(),
  amount:            z.number().int().positive(),
  description:       z.string().min(1).max(500),
  expenseDate:       dateString,
  isRecurring:       z.boolean().optional().default(false),
  recurringInterval: z.enum(['WEEKLY', 'MONTHLY']).optional(),
});

export const createExpenseSchema = expenseBaseSchema.refine(
  (d) => !d.isRecurring || d.recurringInterval !== undefined,
  { message: 'recurringInterval is required when isRecurring is true', path: ['recurringInterval'] },
);

export const updateExpenseSchema = expenseBaseSchema
  .omit({ isRecurring: true, recurringInterval: true })
  .partial();

export const rejectExpenseSchema = z.object({
  note: z.string().min(1).max(500),
});

export const listExpensesSchema = z.object({
  page:       z.coerce.number().int().positive().optional().default(1),
  limit:      z.coerce.number().int().positive().max(100).optional().default(20),
  branchId:   z.string().cuid().optional(),
  categoryId: z.string().cuid().optional(),
  status:     z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  startDate:  z.string().optional(),
  endDate:    z.string().optional(),
  format:     z.enum(['json', 'csv']).optional().default('json'),
});

export const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
});

export const updateCategorySchema = createCategorySchema;

export type CreateExpenseInput       = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput       = z.infer<typeof updateExpenseSchema>;
export type RejectExpenseInput       = z.infer<typeof rejectExpenseSchema>;
export type ListExpensesQuery        = z.infer<typeof listExpensesSchema>;
export type CreateCategoryInput      = z.infer<typeof createCategorySchema>;
