import type { Request, Response } from 'express';
import * as reportsService from './reports.service';
import { sendSuccess } from '../../utils/response';
import { sendCSV } from '../../utils/csv';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../middleware/error';
import { resolveStoreIdForRequest } from '../../middleware/tenant';
import {
  baseDateRangeSchema,
  salesSummarySchema,
  salesByProductSchema,
  expensesSummarySchema,
} from './reports.schema';

// ─── Scope helpers ────────────────────────────────────────────────────────────

function getScope(req: Request) {
  const { sub: userId, role, branchId: userBranchId } = req.user!;
  const storeId = resolveStoreIdForRequest(req);
  const branchId = role === 'BRANCH_MANAGER' || role === 'CASHIER' ? userBranchId : undefined;
  return { userId, role, storeId, branchId };
}

function requireAdminRole(role: string) {
  if (role === 'CASHIER' || role === 'BRANCH_MANAGER') {
    throw new AppError('Insufficient permissions for this report', 403);
  }
}

// ─── Generic respond (JSON or CSV) ────────────────────────────────────────────

function respond(
  req: Request,
  res: Response,
  data: unknown[],
  filename: string,
  format?: string,
): void {
  if (format === 'csv') {
    sendCSV(res, data as Record<string, unknown>[], filename);
  } else {
    sendSuccess(res, data);
  }
}

function respondOne(
  req: Request,
  res: Response,
  data: Record<string, unknown>,
  filename: string,
  format?: string,
): void {
  if (format === 'csv') {
    sendCSV(res, [data], filename);
  } else {
    sendSuccess(res, data);
  }
}

// ─── Sales Summary ────────────────────────────────────────────────────────────

export const salesSummary = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role, storeId, branchId } = getScope(req);
  const query = salesSummarySchema.parse(req.query);

  const data = await reportsService.getSalesSummary(role, userId, storeId, branchId, query);
  respond(req, res, data, 'sales-summary', query.format);
});

// ─── Sales by Product ─────────────────────────────────────────────────────────

export const salesByProduct = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role, storeId, branchId } = getScope(req);
  const query = salesByProductSchema.parse(req.query);

  const data = await reportsService.getSalesByProduct(role, userId, storeId, branchId, query);
  respond(req, res, data, 'sales-by-product', query.format);
});

// ─── Sales by Category ────────────────────────────────────────────────────────

export const salesByCategory = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role, storeId, branchId } = getScope(req);
  const query = baseDateRangeSchema.parse(req.query);

  const data = await reportsService.getSalesByCategory(role, userId, storeId, branchId, query);
  respond(req, res, data, 'sales-by-category', query.format);
});

// ─── Sales by Cashier ─────────────────────────────────────────────────────────

export const salesByCashier = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role, storeId, branchId } = getScope(req);
  const query = baseDateRangeSchema.parse(req.query);

  const data = await reportsService.getSalesByCashier(role, userId, storeId, branchId, query);
  respond(req, res, data, 'sales-by-cashier', query.format);
});

// ─── Sales by Branch ──────────────────────────────────────────────────────────

export const salesByBranch = asyncHandler(async (req: Request, res: Response) => {
  const { role, storeId } = getScope(req);
  requireAdminRole(role);
  const query = baseDateRangeSchema.parse(req.query);

  const data = await reportsService.getSalesByBranch(storeId, query);
  respond(req, res, data, 'sales-by-branch', query.format);
});

// ─── Payment Methods Breakdown ────────────────────────────────────────────────

export const paymentMethodsBreakdown = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role, storeId, branchId } = getScope(req);
  const query = baseDateRangeSchema.parse(req.query);

  const data = await reportsService.getPaymentMethodsBreakdown(
    role,
    userId,
    storeId,
    branchId,
    query,
  );
  respond(req, res, data, 'payment-methods', query.format);
});

// ─── Inventory Valuation ──────────────────────────────────────────────────────

export const inventoryValuation = asyncHandler(async (req: Request, res: Response) => {
  const { role, storeId, branchId } = getScope(req);
  requireAdminRole(role);
  const query = baseDateRangeSchema.parse(req.query);

  const { items, totals } = await reportsService.getInventoryValuation(storeId, branchId);

  if (query.format === 'csv') {
    sendCSV(res, items as Record<string, unknown>[], 'inventory-valuation');
  } else {
    sendSuccess(res, { items, totals });
  }
});

// ─── Profit ───────────────────────────────────────────────────────────────────

export const profit = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role, storeId, branchId } = getScope(req);
  const query = baseDateRangeSchema.parse(req.query);

  const data = await reportsService.getProfit(role, userId, storeId, branchId, query);
  respondOne(req, res, data as unknown as Record<string, unknown>, 'profit', query.format);
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

export const dashboard = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role, storeId, branchId } = getScope(req);

  const data = await reportsService.getDashboardExtended(role, userId, storeId, branchId);
  sendSuccess(res, data);
});

// ─── Expenses Summary ─────────────────────────────────────────────────────────

export const expensesSummary = asyncHandler(async (req: Request, res: Response) => {
  const { role, storeId, branchId } = getScope(req);
  const query = expensesSummarySchema.parse(req.query);

  const data = await reportsService.getExpensesSummary(storeId, branchId, role, query);
  if (query.format === 'csv') {
    sendCSV(res, data.byCategory as unknown as Record<string, unknown>[], 'expenses-summary');
  } else {
    sendSuccess(res, data);
  }
});

// ─── Profit & Loss ────────────────────────────────────────────────────────────

export const profitAndLoss = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role, storeId, branchId } = getScope(req);
  const query = baseDateRangeSchema.parse(req.query);

  const data = await reportsService.getProfitAndLoss(role, userId, storeId, branchId, query);
  respondOne(req, res, data as unknown as Record<string, unknown>, 'profit-and-loss', query.format);
});
