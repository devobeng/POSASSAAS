import { z } from 'zod';

export const updateStoreSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    currency: z.string().length(3).transform((v) => v.toUpperCase()).optional(),
  })
  .strict();

export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;

export const receiptSettingsSchema = z.object({
  headerText:             z.string().max(200).nullable().optional(),
  footerText:             z.string().max(200).nullable().optional(),
  paperWidth:             z.enum(['58', '80']).transform(Number).optional(),
  showLogo:               z.boolean().optional(),
  showQrCode:             z.boolean().optional(),
  weightedBarcodeEnabled: z.boolean().optional(),
  weightedBarcodeType:    z.enum(['price', 'weight']).optional(),
});

export type ReceiptSettingsInput = z.infer<typeof receiptSettingsSchema>;
