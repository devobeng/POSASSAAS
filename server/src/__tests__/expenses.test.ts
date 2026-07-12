import request from 'supertest';
import { app } from '../app';
import { signAccessToken } from '../utils/jwt';
import { materializeRecurringExpenses } from '../modules/expenses/expenses.cron';

// ── Prisma mock ───────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  prisma: {
    expense: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    expenseCategory: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      createMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../config/database') as {
  prisma: {
    expense: {
      findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock;
      update: jest.Mock; delete: jest.Mock; count: jest.Mock;
    };
    expenseCategory: {
      findMany: jest.Mock; findFirst: jest.Mock; createMany: jest.Mock;
      create: jest.Mock; update: jest.Mock; delete: jest.Mock;
    };
    auditLog: { create: jest.Mock };
    $queryRaw: jest.Mock;
  };
};

// ── Token helpers ─────────────────────────────────────────────────────────────

function token(role: string, extra: Record<string, string> = {}) {
  return signAccessToken({
    sub:      'user-1',
    email:    'test@store.com',
    role,
    storeId:  'store-1',
    branchId: 'branch-1',
    ...extra,
  });
}

const adminToken   = token('STORE_ADMIN');
const managerToken = token('BRANCH_MANAGER', { sub: 'manager-1' });
const cashierToken = token('CASHIER');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PENDING_EXPENSE = {
  id: 'exp-1',
  storeId: 'store-1',
  branchId: 'branch-1',
  categoryId: 'cat-1',
  amount: 500000,
  description: 'Rent',
  expenseDate: new Date('2026-07-01'),
  status: 'PENDING',
  recordedById: 'manager-1',
  approvedById: null,
  rejectionNote: null,
  isRecurring: false,
  recurringInterval: null,
  nextDueDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const APPROVED_EXPENSE = { ...PENDING_EXPENSE, id: 'exp-2', status: 'APPROVED', recordedById: 'manager-2', approvedById: 'user-1' };

beforeEach(() => jest.clearAllMocks());

// ── Test 1: Branch manager cannot approve their own expense ───────────────────

describe('POST /api/v1/expenses/:id/approve', () => {
  it('returns 403 when the approver recorded the expense', async () => {
    // The expense was recorded by 'manager-1' — same as the store admin calling approve
    // In this test the admin token is sub=user-1, but we simulate a manager trying to approve their own
    // We use a manager token (sub=manager-1) hitting the admin-only approve route → first gets 403 from RBAC
    // So instead we set up admin token (sub=user-1) approving an expense recorded by user-1

    const selfRecordedExpense = { ...PENDING_EXPENSE, recordedById: 'user-1' };
    prisma.expense.findFirst.mockResolvedValueOnce(selfRecordedExpense);

    const res = await request(app)
      .post('/api/v1/expenses/exp-1/approve')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/cannot approve/i);
    expect(prisma.expense.update).not.toHaveBeenCalled();
  });

  it('returns 403 for BRANCH_MANAGER role (approve is STORE_ADMIN only)', async () => {
    const res = await request(app)
      .post('/api/v1/expenses/exp-1/approve')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(403);
  });

  it('approves when admin is not the recorder', async () => {
    prisma.expense.findFirst.mockResolvedValueOnce(PENDING_EXPENSE); // recordedById = 'manager-1', approver = 'user-1'
    prisma.expense.update.mockResolvedValueOnce({ ...PENDING_EXPENSE, status: 'APPROVED', approvedById: 'user-1' });
    prisma.auditLog.create.mockResolvedValueOnce({});

    const res = await request(app)
      .post('/api/v1/expenses/exp-1/approve')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
  });
});

// ── Test 2: Rejected expenses excluded from P&L ───────────────────────────────

describe('GET /api/v1/reports/profit-and-loss', () => {
  it('only sums APPROVED expenses — rejected rows do not appear', async () => {
    // Revenue query returns a total
    prisma.$queryRaw
      .mockResolvedValueOnce([{ revenue: '10000000', cogs: '4000000', order_count: 10n }])
      // Expense query returns only APPROVED category rows (SQL filters by status = 'APPROVED')
      .mockResolvedValueOnce([
        { category_id: 'cat-1', category_name: 'Rent',      total_amount: '2000000' },
        { category_id: 'cat-2', category_name: 'Utilities', total_amount:  '500000' },
      ]);

    const res = await request(app)
      .get('/api/v1/reports/profit-and-loss')
      .query({ startDate: '2026-07-01', endDate: '2026-07-31' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const d = res.body.data;

    // Gross profit = 10M - 4M = 6M
    expect(d.grossProfit).toBe(6_000_000);
    // Total expenses = 2M + 0.5M = 2.5M (REJECTED expense not in list)
    expect(d.totalExpenses).toBe(2_500_000);
    // Net profit = 6M - 2.5M = 3.5M
    expect(d.netProfit).toBe(3_500_000);
    // Rejected expense is not in expensesByCategory
    expect(d.expensesByCategory).toHaveLength(2);
    expect(d.expensesByCategory.map((e: { categoryName: string }) => e.categoryName)).not.toContain('Maintenance');
  });
});

// ── Test 3: Recurring monthly expense materialises correctly ──────────────────

describe('materializeRecurringExpenses()', () => {
  it('creates a new PENDING record and advances nextDueDate by one month', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const template = {
      id: 'tpl-1',
      storeId: 'store-1',
      branchId: 'branch-1',
      categoryId: 'cat-1',
      amount: 500000,
      description: 'Monthly rent',
      expenseDate: yesterday,
      status: 'APPROVED',
      recordedById: 'admin-1',
      isRecurring: true,
      recurringInterval: 'MONTHLY',
      nextDueDate: yesterday, // overdue by 1 day
    };

    prisma.expense.findMany.mockResolvedValueOnce([template]);
    prisma.expense.create.mockResolvedValueOnce({ id: 'new-exp', status: 'PENDING' });
    prisma.expense.update.mockResolvedValueOnce({});

    await materializeRecurringExpenses();

    // One new PENDING record created
    expect(prisma.expense.create).toHaveBeenCalledTimes(1);
    expect(prisma.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          isRecurring: false,
          expenseDate: yesterday,
          storeId: 'store-1',
        }),
      }),
    );

    // Template nextDueDate advanced by 1 month
    const expectedNext = new Date(yesterday);
    expectedNext.setMonth(expectedNext.getMonth() + 1);

    expect(prisma.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tpl-1' },
        data: { nextDueDate: expectedNext },
      }),
    );
  });

  it('generates multiple records for a template overdue by 2+ intervals (catch-up)', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sixWeeksAgo = new Date(today);
    sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);

    const template = {
      id: 'tpl-2',
      storeId: 'store-1',
      branchId: null,
      categoryId: 'cat-1',
      amount: 100000,
      description: 'Weekly supplies',
      expenseDate: sixWeeksAgo,
      status: 'APPROVED',
      recordedById: 'admin-1',
      isRecurring: true,
      recurringInterval: 'WEEKLY',
      nextDueDate: sixWeeksAgo,
    };

    prisma.expense.findMany.mockResolvedValueOnce([template]);
    prisma.expense.create.mockResolvedValue({ id: 'new', status: 'PENDING' });
    prisma.expense.update.mockResolvedValueOnce({});

    await materializeRecurringExpenses();

    // 6 weeks overdue = 6 PENDING records
    expect(prisma.expense.create).toHaveBeenCalledTimes(6);
  });
});

// ── Test 4: P&L math verified against fixture data ────────────────────────────

describe('P&L math correctness', () => {
  it('computes grossProfit, netProfit, and margin percentages correctly', async () => {
    // Revenue = 10,000,000 (₦100,000.00), COGS = 4,000,000, expenses = 2,500,000
    prisma.$queryRaw
      .mockResolvedValueOnce([{ revenue: '10000000', cogs: '4000000', order_count: 5n }])
      .mockResolvedValueOnce([
        { category_id: 'cat-1', category_name: 'Rent',      total_amount: '2000000' },
        { category_id: 'cat-2', category_name: 'Utilities', total_amount:  '500000' },
      ]);

    const res = await request(app)
      .get('/api/v1/reports/profit-and-loss')
      .query({ startDate: '2026-07-01', endDate: '2026-07-31' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const d = res.body.data;

    // Gross profit = revenue - cogs
    expect(d.revenue).toBe(10_000_000);
    expect(d.cogs).toBe(4_000_000);
    expect(d.grossProfit).toBe(6_000_000);

    // Gross margin % = (6M / 10M) * 100 = 60%
    expect(d.grossMarginPct).toBeCloseTo(60.0);

    // Net profit = grossProfit - totalExpenses
    expect(d.totalExpenses).toBe(2_500_000);
    expect(d.netProfit).toBe(3_500_000);

    // Net margin % = (3.5M / 10M) * 100 = 35%
    expect(d.netMarginPct).toBeCloseTo(35.0);
  });

  it('returns 0 margins when revenue is 0 (no divide-by-zero)', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ revenue: '0', cogs: '0', order_count: 0n }])
      .mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/api/v1/reports/profit-and-loss')
      .query({ startDate: '2026-07-01', endDate: '2026-07-31' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.grossMarginPct).toBe(0);
    expect(d.netMarginPct).toBe(0);
    expect(d.netProfit).toBe(0);
  });

  it('blocks CASHIER from the profit-and-loss endpoint', async () => {
    const res = await request(app)
      .get('/api/v1/reports/profit-and-loss')
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(res.status).toBe(403);
  });
});
