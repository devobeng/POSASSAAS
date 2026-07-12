import type { Request, Response } from 'express';
import * as ordersService from './orders.service';
import { sendSuccess } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../middleware/error';
import { createOrderSchema, orderListQuerySchema } from './orders.schema';
import { getIdempotentResult, setIdempotentResult } from '../../utils/idempotency';

// ─── Create order ─────────────────────────────────────────────────────────────

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const { sub: userId, branchId } = req.user!;
  if (!branchId) throw new AppError('No branch assigned to this user', 400);

  // Header-based idempotency check — prevents double-tapping "Charge"
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
  if (idempotencyKey) {
    const cached = getIdempotentResult(userId, idempotencyKey);
    if (cached !== undefined) {
      return sendSuccess(res, cached, 'Order already processed (idempotent)', 200);
    }
  }

  const body = createOrderSchema.parse(req.body);

  const storeId = req.storeId ?? req.user!.storeId;
  if (!storeId) throw new AppError('Store context missing', 400);

  const { order, duplicate } = await ordersService.createOrder(storeId, userId, branchId, body);

  if (idempotencyKey) setIdempotentResult(userId, idempotencyKey, order);

  const statusCode = duplicate ? 200 : 201;
  sendSuccess(res, { ...order, duplicate }, 'Order created', statusCode);
});

// ─── List orders ──────────────────────────────────────────────────────────────

export const listOrders = asyncHandler(async (req: Request, res: Response) => {
  const query = orderListQuerySchema.parse(req.query);
  const { sub: userId, role, branchId, storeId: userStoreId } = req.user!;
  const storeId = req.storeId ?? userStoreId;

  const result = await ordersService.getOrders(role, userId, storeId, branchId, query);

  sendSuccess(res, result.orders, 'Success', 200, {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
});

// ─── Get single order ─────────────────────────────────────────────────────────

export const getOrder = asyncHandler(async (req: Request, res: Response) => {
  const { sub: userId, role, branchId, storeId: userStoreId } = req.user!;
  const storeId = req.storeId ?? userStoreId;

  const order = await ordersService.getOrder(
    role,
    userId,
    storeId,
    branchId,
    req.params.id,
  );

  sendSuccess(res, order);
});

// ─── Refund order ─────────────────────────────────────────────────────────────

export const refundOrder = asyncHandler(async (req: Request, res: Response) => {
  const { sub: userId, role, branchId, storeId: userStoreId } = req.user!;
  const storeId = (req.storeId ?? userStoreId)!;

  const order = await ordersService.refundOrder(
    storeId,
    branchId,
    role,
    userId,
    req.params.id,
  );

  sendSuccess(res, order, 'Order refunded');
});

// ─── Receipt ──────────────────────────────────────────────────────────────────

export const getReceipt = asyncHandler(async (req: Request, res: Response) => {
  const { sub: userId, role, branchId, storeId: userStoreId } = req.user!;
  const storeId = (req.storeId ?? userStoreId)!;

  const receipt = await ordersService.getReceipt(
    storeId,
    branchId,
    role,
    userId,
    req.params.id,
  );

  sendSuccess(res, receipt);
});
