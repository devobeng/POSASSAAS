import { Prisma, ExpenseStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error';
import { auditLog } from '../../utils/audit';
import { uploadImage } from '../../utils/cloudinary';
import type { CreateExpenseInput, UpdateExpenseInput, RejectExpenseInput, ListExpensesQuery, CreateCategoryInput } from './expenses.schema';

// ─── Default category names seeded for every new store ───────────────────────

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent', 'Utilities', 'Salaries', 'Supplies',
  'Transport', 'Marketing', 'Maintenance', 'Other',
] as const;

export async function seedDefaultCategories(storeId: string) {
  await prisma.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ storeId, name, isDefault: true })),
    skipDuplicates: true,
  });
}

// The categoryId FK only guarantees the row exists SOMEWHERE — without this,
// a caller who obtains another store's ExpenseCategory id (guessable cuid,
// or leaked via some other channel) can attach their own expense to it,
// leaking that category's name into their own reports/joins. Mirrors
// products.service.ts's assertCategoryInStore for the same class of bug.
async function assertExpenseCategoryInStore(storeId: string, categoryId: string): Promise<void> {
  const category = await prisma.expenseCategory.findFirst({
    where: { id: categoryId, storeId },
    select: { id: true },
  });
  if (!category) throw new AppError('Expense category not found or does not belong to this store', 404);
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function listCategories(storeId: string) {
  return prisma.expenseCategory.findMany({
    where: { storeId },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { expenses: true } } },
  });
}

export async function createCategory(storeId: string, data: CreateCategoryInput, actorId: string) {
  const cat = await prisma.expenseCategory.create({
    data: { storeId, name: data.name, isDefault: false },
  });
  await auditLog({ storeId, userId: actorId, action: 'CREATE', entity: 'ExpenseCategory', entityId: cat.id });
  return cat;
}

export async function updateCategory(
  storeId: string,
  id: string,
  data: CreateCategoryInput,
  actorId: string,
) {
  const cat = await prisma.expenseCategory.findFirst({ where: { id, storeId } });
  if (!cat) throw new AppError('Category not found', 404);
  const updated = await prisma.expenseCategory.update({ where: { id }, data: { name: data.name } });
  await auditLog({ storeId, userId: actorId, action: 'UPDATE', entity: 'ExpenseCategory', entityId: id });
  return updated;
}

export async function deleteCategory(storeId: string, id: string, actorId: string) {
  const cat = await prisma.expenseCategory.findFirst({
    where: { id, storeId },
    include: { _count: { select: { expenses: true } } },
  });
  if (!cat) throw new AppError('Category not found', 404);
  if (cat._count.expenses > 0) {
    throw new AppError(
      `Cannot delete — this category has ${cat._count.expenses} expense(s). Reassign them first.`,
      409,
    );
  }
  await prisma.expenseCategory.delete({ where: { id } });
  await auditLog({ storeId, userId: actorId, action: 'DELETE', entity: 'ExpenseCategory', entityId: id });
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

function buildDateFilter(start?: string, end?: string): Prisma.ExpenseWhereInput {
  if (!start && !end) return {};
  const expenseDate: Prisma.DateTimeFilter = {};
  if (start) expenseDate.gte = new Date(start);
  if (end)   expenseDate.lte = new Date(end);
  return { expenseDate };
}

function buildExpenseWhere(
  storeId: string,
  callerBranchId: string | undefined,
  role: string,
  query: Pick<ListExpensesQuery, 'branchId' | 'categoryId' | 'status' | 'startDate' | 'endDate'>,
): Prisma.ExpenseWhereInput {
  // BRANCH_MANAGER can only see own branch
  const effectiveBranchId = role === 'BRANCH_MANAGER' ? callerBranchId : query.branchId;

  return {
    storeId,
    ...(effectiveBranchId && { branchId: effectiveBranchId }),
    ...(query.categoryId && { categoryId: query.categoryId }),
    ...(query.status && { status: query.status as ExpenseStatus }),
    ...buildDateFilter(query.startDate, query.endDate),
  };
}

const EXPENSE_INCLUDE = {
  category:   { select: { id: true, name: true } },
  branch:     { select: { id: true, name: true } },
  recordedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
} as const;

export async function listExpenses(
  storeId: string,
  callerBranchId: string | undefined,
  role: string,
  query: ListExpensesQuery,
) {
  const { page, limit } = query;
  const where = buildExpenseWhere(storeId, callerBranchId, role, query);

  const [total, items] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: EXPENSE_INCLUDE,
    }),
  ]);

  return { total, page, limit, items };
}

// CSV export must reflect the WHOLE matching range, not just whatever page
// the UI happened to be on — listExpenses's `limit` (max 100) is a display
// page size, not a real cap, and silently truncating a year-end export to
// 100 rows with no error is worse than a slow query for a large range.
export async function exportExpenses(
  storeId: string,
  callerBranchId: string | undefined,
  role: string,
  query: Pick<ListExpensesQuery, 'branchId' | 'categoryId' | 'status' | 'startDate' | 'endDate'>,
) {
  const where = buildExpenseWhere(storeId, callerBranchId, role, query);
  return prisma.expense.findMany({
    where,
    orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    include: EXPENSE_INCLUDE,
  });
}

export async function getExpense(
  storeId: string,
  id: string,
  callerBranchId: string | undefined,
  role: string,
) {
  const expense = await prisma.expense.findFirst({
    where: { id, storeId },
    include: {
      category:   { select: { id: true, name: true } },
      branch:     { select: { id: true, name: true } },
      recordedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
    },
  });
  if (!expense) throw new AppError('Expense not found', 404);
  // Same branch restriction as update/delete — a BRANCH_MANAGER could
  // otherwise read another branch's expense amounts/descriptions/receipts
  // just by knowing or guessing its id.
  if (role === 'BRANCH_MANAGER' && expense.branchId !== callerBranchId) {
    throw new AppError('Forbidden', 403);
  }
  return expense;
}

function nextDueDate(from: Date, interval: 'WEEKLY' | 'MONTHLY'): Date {
  const d = new Date(from);
  if (interval === 'WEEKLY') {
    d.setDate(d.getDate() + 7);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d;
}

export async function createExpense(
  storeId: string,
  callerBranchId: string | undefined,
  role: string,
  recordedById: string,
  data: CreateExpenseInput,
) {
  await assertExpenseCategoryInStore(storeId, data.categoryId);

  // Determine which branch this expense belongs to
  const branchId = role === 'BRANCH_MANAGER' ? callerBranchId : data.branchId;

  // STORE_ADMIN expenses are auto-approved; BRANCH_MANAGER expenses start PENDING
  const status: ExpenseStatus = role === 'STORE_ADMIN' || role === 'SUPER_ADMIN'
    ? ExpenseStatus.APPROVED
    : ExpenseStatus.PENDING;

  const approvedById = status === ExpenseStatus.APPROVED ? recordedById : undefined;

  const expenseDate = new Date(data.expenseDate);
  const nd = data.isRecurring && data.recurringInterval
    ? nextDueDate(expenseDate, data.recurringInterval)
    : undefined;

  const expense = await prisma.expense.create({
    data: {
      storeId,
      branchId:          branchId ?? null,
      categoryId:        data.categoryId,
      amount:            data.amount,
      description:       data.description,
      expenseDate,
      isRecurring:       data.isRecurring ?? false,
      recurringInterval: data.recurringInterval ?? null,
      nextDueDate:       nd ?? null,
      recordedById,
      status,
      approvedById:      approvedById ?? null,
    },
    include: {
      category:   { select: { id: true, name: true } },
      branch:     { select: { id: true, name: true } },
      recordedBy: { select: { id: true, name: true } },
    },
  });

  await auditLog({
    storeId,
    userId: recordedById,
    action: 'CREATE',
    entity: 'Expense',
    entityId: expense.id,
    metadata: { amount: data.amount, status },
  });

  return expense;
}

export async function updateExpense(
  storeId: string,
  id: string,
  callerBranchId: string | undefined,
  role: string,
  actorId: string,
  data: UpdateExpenseInput,
) {
  const existing = await prisma.expense.findFirst({ where: { id, storeId } });
  if (!existing) throw new AppError('Expense not found', 404);
  if (existing.status !== ExpenseStatus.PENDING) {
    throw new AppError('Only PENDING expenses can be edited', 409);
  }
  // Branch managers can only edit their own branch's expenses
  if (role === 'BRANCH_MANAGER' && existing.branchId !== callerBranchId) {
    throw new AppError('Forbidden', 403);
  }
  if (data.categoryId) {
    await assertExpenseCategoryInStore(storeId, data.categoryId);
  }

  const updated = await prisma.expense.update({
    where: { id },
    data: {
      ...(data.categoryId  && { categoryId: data.categoryId }),
      ...(data.amount      !== undefined && { amount: data.amount }),
      ...(data.description && { description: data.description }),
      ...(data.expenseDate && { expenseDate: new Date(data.expenseDate) }),
      ...(data.branchId    !== undefined && role !== 'BRANCH_MANAGER' && { branchId: data.branchId }),
    },
    include: {
      category:   { select: { id: true, name: true } },
      branch:     { select: { id: true, name: true } },
      recordedBy: { select: { id: true, name: true } },
    },
  });

  await auditLog({ storeId, userId: actorId, action: 'UPDATE', entity: 'Expense', entityId: id });
  return updated;
}

export async function deleteExpense(
  storeId: string,
  id: string,
  callerBranchId: string | undefined,
  role: string,
  actorId: string,
) {
  const existing = await prisma.expense.findFirst({ where: { id, storeId } });
  if (!existing) throw new AppError('Expense not found', 404);
  if (existing.status === ExpenseStatus.APPROVED && role !== 'STORE_ADMIN' && role !== 'SUPER_ADMIN') {
    throw new AppError('Only store admins can delete approved expenses', 403);
  }
  if (role === 'BRANCH_MANAGER' && existing.branchId !== callerBranchId) {
    throw new AppError('Forbidden', 403);
  }
  await prisma.expense.delete({ where: { id } });
  await auditLog({ storeId, userId: actorId, action: 'DELETE', entity: 'Expense', entityId: id });
}

export async function approveExpense(storeId: string, id: string, approverId: string) {
  const existing = await prisma.expense.findFirst({ where: { id, storeId } });
  if (!existing) throw new AppError('Expense not found', 404);
  if (existing.status !== ExpenseStatus.PENDING) {
    throw new AppError('Only PENDING expenses can be approved', 409);
  }
  // Guard: a manager cannot approve their own expense (they record as PENDING)
  if (existing.recordedById === approverId) {
    throw new AppError('You cannot approve an expense you recorded', 403);
  }

  const updated = await prisma.expense.update({
    where: { id },
    data: { status: ExpenseStatus.APPROVED, approvedById: approverId, rejectionNote: null },
  });

  await auditLog({
    storeId,
    userId: approverId,
    action: 'APPROVE',
    entity: 'Expense',
    entityId: id,
    metadata: { amount: existing.amount },
  });

  return updated;
}

export async function rejectExpense(
  storeId: string,
  id: string,
  approverId: string,
  data: RejectExpenseInput,
) {
  const existing = await prisma.expense.findFirst({ where: { id, storeId } });
  if (!existing) throw new AppError('Expense not found', 404);
  if (existing.status !== ExpenseStatus.PENDING) {
    throw new AppError('Only PENDING expenses can be rejected', 409);
  }

  const updated = await prisma.expense.update({
    where: { id },
    data: { status: ExpenseStatus.REJECTED, approvedById: approverId, rejectionNote: data.note },
  });

  await auditLog({
    storeId,
    userId: approverId,
    action: 'REJECT',
    entity: 'Expense',
    entityId: id,
    metadata: { note: data.note },
  });

  return updated;
}

export async function uploadReceiptImage(
  storeId: string,
  id: string,
  buffer: Buffer,
  actorId: string,
) {
  const existing = await prisma.expense.findFirst({ where: { id, storeId } });
  if (!existing) throw new AppError('Expense not found', 404);

  const url = await uploadImage(buffer, `pos/expenses/${storeId}`, id);
  const updated = await prisma.expense.update({
    where: { id },
    data: { receiptImageUrl: url },
    select: { id: true, receiptImageUrl: true },
  });

  await auditLog({ storeId, userId: actorId, action: 'UPLOAD_RECEIPT', entity: 'Expense', entityId: id });
  return updated;
}
