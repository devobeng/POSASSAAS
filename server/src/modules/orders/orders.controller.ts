import type { Request, Response } from 'express';
import * as ordersService from './orders.service';
import { sendSuccess } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../middleware/error';
import { resolveStoreIdForRequest } from '../../middleware/tenant';
import { createOrderSchema, orderListQuerySchema } from './orders.schema';

// ─── Create order ─────────────────────────────────────────────────────────────
// Idempotency (double-tapped "Charge") is handled entirely by
// orders.service.ts via the (storeId, clientOrderId) DB unique constraint —
// race-safe under concurrency and correct across more than one server
// instance, unlike an in-process cache. The Idempotency-Key header is folded
// into clientOrderId (when the body doesn't already supply one) so callers
// using either convention go through that same DB-level mechanism rather
// than a separate, weaker one.

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const { sub: userId, branchId } = req.user!;
  if (!branchId) throw new AppError('No branch assigned to this user', 400);

  const body = createOrderSchema.parse(req.body);

  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
  if (idempotencyKey && !body.clientOrderId) {
    body.clientOrderId = idempotencyKey;
  }

  const storeId = req.storeId ?? req.user!.storeId;
  if (!storeId) throw new AppError('Store context missing', 400);

  const { order, duplicate } = await ordersService.createOrder(storeId, userId, branchId, body);

  const statusCode = duplicate ? 200 : 201;
  sendSuccess(res, { ...order, duplicate }, 'Order created', statusCode);
});

// ─── List orders ──────────────────────────────────────────────────────────────

export const listOrders = asyncHandler(async (req: Request, res: Response) => {
  const query = orderListQuerySchema.parse(req.query);
  const { sub: userId, role, branchId } = req.user!;
  const storeId = resolveStoreIdForRequest(req);

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
  const { sub: userId, role, branchId } = req.user!;
  const storeId = resolveStoreIdForRequest(req);

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
  const { sub: userId, role, branchId } = req.user!;
  const storeId = resolveStoreIdForRequest(req);

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
  const { sub: userId, role, branchId } = req.user!;
  const storeId = resolveStoreIdForRequest(req);

  const receipt = await ordersService.getReceipt(
    storeId,
    branchId,
    role,
    userId,
    req.params.id,
  );

  sendSuccess(res, receipt);
});
