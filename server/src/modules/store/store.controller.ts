import type { Request, Response } from 'express';
import * as storeService from './store.service';
import { sendSuccess } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../middleware/error';
import type { UpdateStoreInput, ReceiptSettingsInput, CreateAuditEntryInput } from './store.schema';

export const getStore = asyncHandler(async (req: Request, res: Response) => {
  const store = await storeService.getStore(req.storeId!);
  sendSuccess(res, store);
});

export const updateStore = asyncHandler(async (req: Request, res: Response) => {
  const store = await storeService.updateStore(
    req.storeId!,
    req.body as UpdateStoreInput,
    req.user!.sub,
  );
  sendSuccess(res, store, 'Store updated');
});

export const uploadLogo = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new AppError('No file uploaded', 400);
  const result = await storeService.uploadStoreLogo(
    req.storeId!,
    req.file.buffer,
    req.user!.sub,
  );
  sendSuccess(res, result, 'Logo uploaded');
});

export const getReceiptSettings = asyncHandler(async (req: Request, res: Response) => {
  const settings = await storeService.getReceiptSettings(req.storeId!);
  sendSuccess(res, settings);
});

export const updateReceiptSettings = asyncHandler(async (req: Request, res: Response) => {
  const settings = await storeService.upsertReceiptSettings(
    req.storeId!,
    req.body as ReceiptSettingsInput,
    req.user!.sub,
  );
  sendSuccess(res, settings, 'Receipt settings updated');
});

export const createAuditEntry = asyncHandler(async (req: Request, res: Response) => {
  const { action, entity, entityId, metadata } = req.body as CreateAuditEntryInput;
  await storeService.createAuditEntry(
    req.storeId ?? null,
    req.user!.sub,
    action,
    entity,
    entityId,
    metadata,
  );
  sendSuccess(res, null, 'Logged');
});
