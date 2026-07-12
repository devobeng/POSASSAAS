import { z } from 'zod';

export const createCategorySchema = z.object({
  name: z.string().min(1).max(100).trim(),
});

export const updateCategorySchema = createCategorySchema.partial();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
