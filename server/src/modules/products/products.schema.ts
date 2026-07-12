import { z } from 'zod';

export const createProductSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  categoryId: z.string().min(1).optional(),
  sku: z.string().max(100).trim().optional(),
  barcode: z.string().max(100).trim().optional(),
  costPrice: z.number().nonnegative(),
  sellingPrice: z.number().nonnegative(),
  taxRate: z.number().min(0).max(100).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

// SKU is immutable once created
export const updateProductSchema = createProductSchema
  .omit({ sku: true })
  .partial();

export const productListQuerySchema = z.object({
  search: z.string().optional(),
  categoryId: z.string().optional(),
  isActive: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : undefined),
    z.boolean().optional(),
  ),
  sortBy: z
    .enum(['name', 'createdAt', 'sellingPrice', 'costPrice'])
    .optional()
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
