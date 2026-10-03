import { z } from 'zod';

export const updateStoreSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    currency: z.string().length(3).transform((v) => v.toUpperCase()).optional(),
    // BRANCH_MANAGER adjustments with |quantity| over this go to STORE_ADMIN
    // approval instead of applying immediately.
    stockAdjustmentThreshold: z.number().int().positive().max(100000).optional(),
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

// This endpoint is reachable by every role including CASHIER (it exists so
// the POS terminal can log till-side events like a manual drawer open) and
// previously took action/entity/entityId/metadata straight from req.body
// with no validation at all — any authenticated user could forge an
// AuditLog entry with an arbitrary action/entity, including one that looks
// like a system-generated entry (e.g. "PAYMENT_SUCCESS"), undermining its
// use as evidence. Restricted to the actual client-originated event types
// (currently just the cash-drawer log in useAuditDrawer.ts) rather than
// free text.
const CLIENT_AUDIT_ACTIONS = ['DRAWER_OPENED'] as const;
const CLIENT_AUDIT_ENTITIES = ['CashDrawer'] as const;

export const createAuditEntrySchema = z
  .object({
    action: z.enum(CLIENT_AUDIT_ACTIONS),
    entity: z.enum(CLIENT_AUDIT_ENTITIES),
    entityId: z.string().min(1).max(100),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => !d.metadata || JSON.stringify(d.metadata).length <= 2000, {
    message: 'metadata is too large',
    path: ['metadata'],
  });

export type CreateAuditEntryInput = z.infer<typeof createAuditEntrySchema>;
