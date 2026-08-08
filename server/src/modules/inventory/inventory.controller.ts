import type { Request, Response } from 'express';
import * as inventoryService from './inventory.service';
import { sendSuccess } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../middleware/error';
import type {
  AdjustStockInput,
  TransferStockInput,
  InventoryQuery,
  MovementsQuery,
  ListAdjustmentRequestsQuery,
  ReviewAdjustmentRequestInput,
  RejectAdjustmentRequestInput,
} from './inventory.schema';

// ─── Branch-ID resolution ─────────────────────────────────────────────────────
// Per CLAUDE.md: never trust branchId from the body for restricted roles.
// BRANCH_MANAGER always uses the branchId on their JWT.
// STORE_ADMIN / SUPER_ADMIN supply it explicitly.

function resolveReadBranchId(req: Request): string | undefined {
  const { role, branchId } = req.user!;
  if (role === 'BRANCH_MANAGER' || role === 'CASHIER') return branchId;
  return req.query.branchId as string | undefined;
}

function resolveWriteBranchId(req: Request, bodyBranchId?: string): string {
  const { role, branchId } = req.user!;
  if (role === 'BRANCH_MANAGER' || role === 'CASHIER') return branchId!;
  if (!bodyBranchId) throw new AppError('branchId is required', 400);
  return bodyBranchId;
}

// ─── Inventory list ───────────────────────────────────────────────────────────

export const getInventory = asyncHandler(async (req: Request, res: Response) => {
  const branchId = resolveReadBranchId(req);
  if (!branchId) throw new AppError('branchId query parameter is required', 400);

  const result = await inventoryService.getInventory(
    req.storeId!,
    branchId,
    req.query as unknown as InventoryQuery,
  );
  sendSuccess(res, result.items, 'Success', 200, {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
});

// ─── Stock adjustment ─────────────────────────────────────────────────────────

export const adjustStock = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as AdjustStockInput;
  const branchId = resolveWriteBranchId(req, body.branchId);

  const result = await inventoryService.requestOrApplyAdjustment({
    storeId: req.storeId!,
    branchId,
    productId: body.productId,
    quantity: body.quantity,
    reason: body.reason,
    note: body.note,
    userId: req.user!.sub,
    role: req.user!.role,
  });

  await inventoryService.logInventoryAudit({
    storeId: req.storeId!,
    userId: req.user!.sub,
    action: result.pending ? 'ADJUST_REQUESTED' : 'ADJUST',
    productId: body.productId,
    branchId,
    metadata: { quantity: body.quantity, reason: body.reason, note: body.note },
  });

  sendSuccess(
    res,
    result,
    result.pending
      ? 'Adjustment exceeds your approval limit — sent to your store admin for review'
      : 'Stock adjusted',
  );
});

// ─── Adjustment approval workflow ─────────────────────────────────────────────

export const listAdjustmentRequests = asyncHandler(async (req: Request, res: Response) => {
  const { role, branchId } = req.user!;
  const result = await inventoryService.listAdjustmentRequests(
    req.storeId!,
    role,
    branchId,
    req.query as unknown as ListAdjustmentRequestsQuery,
  );
  sendSuccess(res, result.requests, 'Success', 200, {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
});

export const approveAdjustmentRequest = asyncHandler(async (req: Request, res: Response) => {
  const { reviewNote } = req.body as ReviewAdjustmentRequestInput;
  const result = await inventoryService.reviewAdjustmentRequest({
    storeId: req.storeId!,
    requestId: req.params.id,
    action: 'APPROVE',
    reviewNote,
    reviewerId: req.user!.sub,
  });
  sendSuccess(res, result, 'Adjustment approved and applied');
});

export const rejectAdjustmentRequest = asyncHandler(async (req: Request, res: Response) => {
  const { reviewNote } = req.body as RejectAdjustmentRequestInput;
  const result = await inventoryService.reviewAdjustmentRequest({
    storeId: req.storeId!,
    requestId: req.params.id,
    action: 'REJECT',
    reviewNote,
    reviewerId: req.user!.sub,
  });
  sendSuccess(res, result, 'Adjustment rejected');
});

// ─── Stock transfer ───────────────────────────────────────────────────────────

export const transferStock = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as TransferStockInput;
  const { role, branchId: tokenBranchId } = req.user!;

  // BRANCH_MANAGER can only transfer OUT from their own branch
  if (
    (role === 'BRANCH_MANAGER' || role === 'CASHIER') &&
    body.fromBranchId !== tokenBranchId
  ) {
    throw new AppError('You can only transfer stock from your own branch', 403);
  }

  const result = await inventoryService.transferStock({
    storeId: req.storeId!,
    fromBranchId: body.fromBranchId,
    toBranchId: body.toBranchId,
    productId: body.productId,
    quantity: body.quantity,
    note: body.note,
    userId: req.user!.sub,
  });

  sendSuccess(res, result, 'Stock transferred');
});

// ─── Movement history ─────────────────────────────────────────────────────────

export const getMovements = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as MovementsQuery;

  // Restrict BRANCH_MANAGER to their own branch
  const { role, branchId: tokenBranchId } = req.user!;
  if ((role === 'BRANCH_MANAGER' || role === 'CASHIER') && !query.branchId) {
    query.branchId = tokenBranchId;
  } else if (role === 'BRANCH_MANAGER' && query.branchId !== tokenBranchId) {
    throw new AppError('You can only view movements for your own branch', 403);
  }

  const result = await inventoryService.getMovements(req.storeId!, query);
  sendSuccess(res, result.movements, 'Success', 200, {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
});

// ─── Low stock ────────────────────────────────────────────────────────────────

export const getLowStock = asyncHandler(async (req: Request, res: Response) => {
  const branchId = resolveReadBranchId(req);
  const items = await inventoryService.getLowStockItems(req.storeId!, branchId);
  sendSuccess(res, items);
});

// ─── Discrepancies (negative stock from offline sales) ────────────────────────

export const getDiscrepancies = asyncHandler(async (req: Request, res: Response) => {
  const branchId = resolveReadBranchId(req);
  const result = await inventoryService.getDiscrepancies(req.storeId!, branchId);
  sendSuccess(res, result);
});
