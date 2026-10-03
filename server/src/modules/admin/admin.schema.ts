import { z } from 'zod';

export const subscriptionPlanSchema = z.object({
  name: z.string().min(1).max(50),
  price: z.number().min(0),
  maxBranches: z.number().int().min(1),
  maxUsers: z.number().int().min(1),
  features: z.record(z.any()),
});

export const getStoresQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => Math.max(1, parseInt(v ?? '1', 10))),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(100, Math.max(1, parseInt(v ?? '20', 10)))),
  search: z.string().optional(),
  status: z
    .enum(['TRIAL', 'ACTIVE', 'INACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED'])
    .optional(),
});

export type SubscriptionPlanInput = z.infer<typeof subscriptionPlanSchema>;
export type GetStoresQuery = z.infer<typeof getStoresQuerySchema>;
