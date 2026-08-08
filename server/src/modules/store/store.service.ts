import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error';
import { uploadImage } from '../../utils/cloudinary';
import { auditLog } from '../../utils/audit';
import type { UpdateStoreInput, ReceiptSettingsInput } from './store.schema';

export async function getStore(storeId: string) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: {
      subscriptionPlan: true,
      _count: {
        select: {
          branches: { where: { isActive: true } },
          users: { where: { isActive: true } },
        },
      },
    },
  });
  if (!store) throw new AppError('Store not found', 404);
  return store;
}

export async function updateStore(storeId: string, data: UpdateStoreInput, actorId: string) {
  const store = await prisma.store.update({
    where: { id: storeId },
    data,
    select: {
      id: true, name: true, slug: true, currency: true,
      subscriptionStatus: true, logoUrl: true, updatedAt: true,
      stockAdjustmentThreshold: true,
    },
  });
  await auditLog({
    storeId,
    userId: actorId,
    action: 'UPDATE',
    entity: 'Store',
    entityId: storeId,
    metadata: { fields: Object.keys(data) },
  });
  return store;
}

// ─── Receipt Settings ─────────────────────────────────────────────────────────

export async function getReceiptSettings(storeId: string) {
  const settings = await prisma.receiptSettings.findUnique({ where: { storeId } });
  if (!settings) {
    // Return defaults — settings are created on first save
    return {
      storeId,
      headerText: null,
      footerText: null,
      paperWidth: 80,
      showLogo: true,
      showQrCode: true,
      weightedBarcodeEnabled: false,
      weightedBarcodeType: 'price',
    };
  }
  return settings;
}

export async function upsertReceiptSettings(
  storeId: string,
  data: ReceiptSettingsInput,
  actorId: string,
) {
  const settings = await prisma.receiptSettings.upsert({
    where: { storeId },
    update: data,
    create: { storeId, ...data },
  });
  await auditLog({
    storeId,
    userId: actorId,
    action: 'UPDATE',
    entity: 'ReceiptSettings',
    entityId: settings.id,
    metadata: { fields: Object.keys(data) },
  });
  return settings;
}

export async function createAuditEntry(
  storeId: string | null,
  actorId: string,
  action: string,
  entity: string,
  entityId: string,
  metadata?: Record<string, unknown>,
) {
  await auditLog({ storeId: storeId ?? undefined, userId: actorId, action, entity, entityId, metadata });
}

export async function uploadStoreLogo(storeId: string, buffer: Buffer, actorId: string) {
  if (!buffer.length) throw new AppError('No file provided', 400);
  const url = await uploadImage(buffer, `pos/stores/${storeId}`, 'logo');
  const store = await prisma.store.update({
    where: { id: storeId },
    data: { logoUrl: url },
    select: { id: true, logoUrl: true },
  });
  await auditLog({
    storeId,
    userId: actorId,
    action: 'UPLOAD_LOGO',
    entity: 'Store',
    entityId: storeId,
  });
  return store;
}
