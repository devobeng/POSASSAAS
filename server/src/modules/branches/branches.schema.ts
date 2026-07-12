import { z } from 'zod';

export const createBranchSchema = z.object({
  name: z.string().min(2).max(100),
  address: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
});

export const updateBranchSchema = createBranchSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
