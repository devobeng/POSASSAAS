import type { Request, Response } from 'express';
import * as syncService from './sync.service';
import { sendSuccess } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../middleware/error';
import { batchSyncSchema, catalogQuerySchema } from './sync.schema';

// ─── POST /api/v1/sync/orders ─────────────────────────────────────────────────

export const batchSync = asyncHandler(async (req: Request, res: Response) => {
  const { sub: userId, branchId, storeId: userStoreId } = req.user!;
  const storeId = req.storeId ?? userStoreId;
  if (!storeId) throw new AppError('Store context missing', 400);
  if (!branchId) throw new AppError('No branch assigned to this user', 400);

  const body = batchSyncSchema.parse(req.body);
  const results = await syncService.syncOrders(storeId, userId, branchId, body);

  const created = results.filter((r) => r.status === 'created').length;
  const duplicates = results.filter((r) => r.status === 'duplicate').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  sendSuccess(res, results, `Batch sync complete: ${created} created, ${duplicates} duplicate, ${failed} failed`, 200);
});

// ─── GET /api/v1/sync/catalog ─────────────────────────────────────────────────

export const getCatalog = asyncHandler(async (req: Request, res: Response) => {
  const { sub: userId, role, branchId, storeId: userStoreId } = req.user!;
  const storeId = req.storeId ?? userStoreId;
  if (!storeId) throw new AppError('Store context missing', 400);

  const query = catalogQuerySchema.parse(req.query);
  const catalog = await syncService.getCatalog(storeId, role, userId, branchId, query);

  sendSuccess(res, catalog);
});
