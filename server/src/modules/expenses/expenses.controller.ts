import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../middleware/error';
import { sendSuccess } from '../../utils/response';
import { sendCSV } from '../../utils/csv';
import * as svc from './expenses.service';
import {
  createExpenseSchema,
  updateExpenseSchema,
  rejectExpenseSchema,
  listExpensesSchema,
  createCategorySchema,
  updateCategorySchema,
} from './expenses.schema';

// ─── Categories ───────────────────────────────────────────────────────────────

export const listCategories = asyncHandler(async (req: Request, res: Response) => {
  const data = await svc.listCategories(req.storeId!);
  sendSuccess(res, data);
});

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const data = createCategorySchema.parse(req.body);
  const cat = await svc.createCategory(req.storeId!, data, req.user!.sub);
  sendSuccess(res, cat, 'Category created', 201);
});

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const data = updateCategorySchema.parse(req.body);
  const cat = await svc.updateCategory(req.storeId!, req.params.id, data, req.user!.sub);
  sendSuccess(res, cat, 'Category updated');
});

export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  await svc.deleteCategory(req.storeId!, req.params.id, req.user!.sub);
  sendSuccess(res, null, 'Category deleted');
});

// ─── Expenses ─────────────────────────────────────────────────────────────────

export const listExpenses = asyncHandler(async (req: Request, res: Response) => {
  const { sub: userId, role, branchId: userBranchId } = req.user!;
  void userId;
  const query = listExpensesSchema.parse(req.query);

  if (query.format === 'csv') {
    const items = await svc.exportExpenses(req.storeId!, userBranchId, role, query);
    sendCSV(res, items as unknown as Record<string, unknown>[], 'expenses');
    return;
  }

  const result = await svc.listExpenses(req.storeId!, userBranchId, role, query);
  sendSuccess(res, result);
});

export const getExpense = asyncHandler(async (req: Request, res: Response) => {
  const { role, branchId } = req.user!;
  const expense = await svc.getExpense(req.storeId!, req.params.id, branchId, role);
  sendSuccess(res, expense);
});

export const createExpense = asyncHandler(async (req: Request, res: Response) => {
  const { sub: userId, role, branchId } = req.user!;
  const data = createExpenseSchema.parse(req.body);
  const expense = await svc.createExpense(req.storeId!, branchId, role, userId, data);
  sendSuccess(res, expense, 'Expense recorded', 201);
});

export const updateExpense = asyncHandler(async (req: Request, res: Response) => {
  const { sub: userId, role, branchId } = req.user!;
  const data = updateExpenseSchema.parse(req.body);
  const expense = await svc.updateExpense(req.storeId!, req.params.id, branchId, role, userId, data);
  sendSuccess(res, expense, 'Expense updated');
});

export const deleteExpense = asyncHandler(async (req: Request, res: Response) => {
  const { sub: userId, role, branchId } = req.user!;
  await svc.deleteExpense(req.storeId!, req.params.id, branchId, role, userId);
  sendSuccess(res, null, 'Expense deleted');
});

export const approveExpense = asyncHandler(async (req: Request, res: Response) => {
  const expense = await svc.approveExpense(req.storeId!, req.params.id, req.user!.sub);
  sendSuccess(res, expense, 'Expense approved');
});

export const rejectExpense = asyncHandler(async (req: Request, res: Response) => {
  const data = rejectExpenseSchema.parse(req.body);
  const expense = await svc.rejectExpense(req.storeId!, req.params.id, req.user!.sub, data);
  sendSuccess(res, expense, 'Expense rejected');
});

export const uploadReceipt = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new AppError('No file uploaded', 400);
  const result = await svc.uploadReceiptImage(
    req.storeId!,
    req.params.id,
    req.file.buffer,
    req.user!.sub,
  );
  sendSuccess(res, result, 'Receipt uploaded');
});
