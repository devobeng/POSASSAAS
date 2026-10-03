import request from 'supertest';
import { app } from '../app';
import { signAccessToken } from '../utils/jwt';
import { localMidnightUTC, defaultDates, startOfTodayInTz } from '../modules/reports/reports.service';
import { __clearInMemoryCacheForTests } from '../utils/cache';

// getStoreTimezone (reports.service.ts) caches its store lookup in-process
// for 5 minutes — without this, a store-abc timezone cached by an earlier
// test would silently skip prisma.store.findUnique in a later test that
// expects that call to happen.
beforeEach(() => __clearInMemoryCacheForTests());

// ─── Prisma mock ──────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    auditLog: { create: jest.fn() },
    store: { findUnique: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../config/database') as {
  prisma: { $queryRaw: jest.Mock; auditLog: { create: jest.Mock }; store: { findUnique: jest.Mock } };
};

// requireFeature() looks this up on every gated report route. Each describe
// block below clears all mocks per-test, so the default (fully-featured
// plan) is set the same way inside each of those — existing tests exercise
// report logic, not feature-gating, and dedicated feature-gating tests
// override this per-case.
function mockFullyFeaturedStore() {
  prisma.store.findUnique.mockResolvedValue({
    subscriptionPlan: { features: { reports: true, analytics: true, multiBranch: true } },
  });
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

const STORE_ID = 'store-abc';
const BRANCH_ID = 'branch-1';

function cashierToken() {
  return signAccessToken({
    sub: 'cashier-id',
    email: 'cashier@test.com',
    role: 'CASHIER',
    storeId: STORE_ID,
    branchId: BRANCH_ID,
  });
}

function managerToken() {
  return signAccessToken({
    sub: 'mgr-id',
    email: 'mgr@test.com',
    role: 'BRANCH_MANAGER',
    storeId: STORE_ID,
    branchId: BRANCH_ID,
  });
}

function adminToken() {
  return signAccessToken({
    sub: 'admin-id',
    email: 'admin@test.com',
    role: 'STORE_ADMIN',
    storeId: STORE_ID,
  });
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const mockSalesSummaryRows = [
  {
    period: new Date('2024-01-01'),
    order_count: 5n,
    revenue: '250.00',
    tax_total: '12.50',
    discount_total: '0.00',
    avg_order_value: '50.00',
  },
];

const mockProductRows = [
  { product_id: 'p-1', product_name: 'Widget', total_quantity: 10n, total_revenue: '100.00' },
];

const mockCategoryRows = [
  { category_id: 'cat-1', category_name: 'Electronics', total_quantity: 10n, total_revenue: '100.00' },
];

const mockCashierRows = [
  { cashier_id: 'cashier-id', cashier_name: 'Jane', order_count: 5n, revenue: '250.00', avg_order_value: '50.00' },
];

const mockBranchRows = [
  { branch_id: BRANCH_ID, branch_name: 'Main Branch', order_count: 5n, revenue: '250.00' },
];

const mockPaymentRows = [
  { method: 'CASH', transaction_count: 3n, total_amount: '150.00' },
  { method: 'PAYSTACK', transaction_count: 2n, total_amount: '100.00' },
];

const mockInvRows = [
  {
    product_id: 'p-1',
    product_name: 'Widget',
    sku: 'WID001',
    total_quantity: 50n,
    cost_price: '8.00',
    selling_price: '10.00',
    cost_value: '400.00',
    selling_value: '500.00',
  },
];

const mockProfitRow = [
  { revenue: '500.00', cogs: '400.00', gross_profit: '100.00', order_count: 10n },
];

// ─── GET /api/v1/reports/sales-summary ───────────────────────────────────────

describe('GET /api/v1/reports/sales-summary', () => {
  beforeEach(() => { jest.clearAllMocks(); mockFullyFeaturedStore(); });

  it('STORE_ADMIN gets daily sales summary → 200 with array', async () => {
    prisma.$queryRaw.mockResolvedValue(mockSalesSummaryRows);

    const res = await request(app)
      .get('/api/v1/reports/sales-summary')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      orderCount: 5,
      revenue: 250,
      taxTotal: 12.5,
    });
  });

  it('returns CSV when format=csv', async () => {
    prisma.$queryRaw.mockResolvedValue(mockSalesSummaryRows);

    const res = await request(app)
      .get('/api/v1/reports/sales-summary?format=csv')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('orderCount');
    expect(res.text).toContain('revenue');
  });

  it('CASHIER is scoped to own orders — cashierFilter injected into query', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await request(app)
      .get('/api/v1/reports/sales-summary')
      .set('Authorization', `Bearer ${cashierToken()}`);

    // The raw query should have been called (scope filter is in the SQL template)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/api/v1/reports/sales-summary');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/reports/sales-by-product ────────────────────────────────────

describe('GET /api/v1/reports/sales-by-product', () => {
  beforeEach(() => { jest.clearAllMocks(); mockFullyFeaturedStore(); });

  it('returns top products → 200', async () => {
    prisma.$queryRaw.mockResolvedValue(mockProductRows);

    const res = await request(app)
      .get('/api/v1/reports/sales-by-product?limit=5')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ productName: 'Widget', totalQuantity: 10 });
  });

  it('returns CSV when format=csv', async () => {
    prisma.$queryRaw.mockResolvedValue(mockProductRows);

    const res = await request(app)
      .get('/api/v1/reports/sales-by-product?format=csv')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });
});

// ─── GET /api/v1/reports/sales-by-category ───────────────────────────────────

describe('GET /api/v1/reports/sales-by-category', () => {
  beforeEach(() => { jest.clearAllMocks(); mockFullyFeaturedStore(); });

  it('returns category breakdown → 200', async () => {
    prisma.$queryRaw.mockResolvedValue(mockCategoryRows);

    const res = await request(app)
      .get('/api/v1/reports/sales-by-category')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].categoryName).toBe('Electronics');
  });
});

// ─── GET /api/v1/reports/sales-by-cashier ────────────────────────────────────

describe('GET /api/v1/reports/sales-by-cashier', () => {
  beforeEach(() => { jest.clearAllMocks(); mockFullyFeaturedStore(); });

  it('STORE_ADMIN sees all cashiers → 200', async () => {
    prisma.$queryRaw.mockResolvedValue(mockCashierRows);

    const res = await request(app)
      .get('/api/v1/reports/sales-by-cashier')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].cashierName).toBe('Jane');
  });

  it('CASHIER cannot access → 403', async () => {
    const res = await request(app)
      .get('/api/v1/reports/sales-by-cashier')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/v1/reports/sales-by-branch ─────────────────────────────────────

describe('GET /api/v1/reports/sales-by-branch', () => {
  beforeEach(() => { jest.clearAllMocks(); mockFullyFeaturedStore(); });

  it('STORE_ADMIN sees all branches → 200', async () => {
    prisma.$queryRaw.mockResolvedValue(mockBranchRows);

    const res = await request(app)
      .get('/api/v1/reports/sales-by-branch')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].branchName).toBe('Main Branch');
  });

  it('BRANCH_MANAGER cannot access → 403', async () => {
    const res = await request(app)
      .get('/api/v1/reports/sales-by-branch')
      .set('Authorization', `Bearer ${managerToken()}`);

    expect(res.status).toBe(403);
  });

  it('CASHIER cannot access → 403', async () => {
    const res = await request(app)
      .get('/api/v1/reports/sales-by-branch')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/v1/reports/payment-methods ─────────────────────────────────────

describe('GET /api/v1/reports/payment-methods', () => {
  beforeEach(() => { jest.clearAllMocks(); mockFullyFeaturedStore(); });

  it('returns payment method breakdown → 200', async () => {
    prisma.$queryRaw.mockResolvedValue(mockPaymentRows);

    const res = await request(app)
      .get('/api/v1/reports/payment-methods')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].method).toBe('CASH');
    expect(res.body.data[0].totalAmount).toBe(150);
  });
});

// ─── GET /api/v1/reports/inventory-valuation ─────────────────────────────────

describe('GET /api/v1/reports/inventory-valuation', () => {
  beforeEach(() => { jest.clearAllMocks(); mockFullyFeaturedStore(); });

  it('STORE_ADMIN gets valuation → 200 with items + totals', async () => {
    prisma.$queryRaw.mockResolvedValue(mockInvRows);

    const res = await request(app)
      .get('/api/v1/reports/inventory-valuation')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items[0]).toMatchObject({ sku: 'WID001', costValue: 400 });
    expect(res.body.data.totals.totalCostValue).toBe(400);
    expect(res.body.data.totals.totalSellingValue).toBe(500);
  });

  it('CASHIER cannot access → 403', async () => {
    const res = await request(app)
      .get('/api/v1/reports/inventory-valuation')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(403);
  });

  it('BRANCH_MANAGER can access → 200 (route allows managerPlus; a stray admin-only check previously blocked them anyway)', async () => {
    prisma.$queryRaw.mockResolvedValue(mockInvRows);

    const res = await request(app)
      .get('/api/v1/reports/inventory-valuation')
      .set('Authorization', `Bearer ${managerToken()}`);

    expect(res.status).toBe(200);
  });

  it('returns CSV of items when format=csv', async () => {
    prisma.$queryRaw.mockResolvedValue(mockInvRows);

    const res = await request(app)
      .get('/api/v1/reports/inventory-valuation?format=csv')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('WID001');
  });
});

// ─── GET /api/v1/reports/profit ──────────────────────────────────────────────

describe('GET /api/v1/reports/profit', () => {
  beforeEach(() => { jest.clearAllMocks(); mockFullyFeaturedStore(); });

  it('returns profit summary → 200', async () => {
    prisma.$queryRaw.mockResolvedValue(mockProfitRow);

    const res = await request(app)
      .get('/api/v1/reports/profit')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      revenue: 500,
      cogs: 400,
      grossProfit: 100,
      orderCount: 10,
    });
    expect(res.body.data.margin).toBeCloseTo(20, 1);
  });

  it('BRANCH_MANAGER can access profit → 200', async () => {
    prisma.$queryRaw.mockResolvedValue(mockProfitRow);

    const res = await request(app)
      .get('/api/v1/reports/profit')
      .set('Authorization', `Bearer ${managerToken()}`);

    expect(res.status).toBe(200);
  });

  it('CASHIER cannot access profit (COGS/margin is not till-level data) → 403', async () => {
    const res = await request(app)
      .get('/api/v1/reports/profit')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(403);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

// ─── GET /api/v1/reports/dashboard ───────────────────────────────────────────

describe('GET /api/v1/reports/dashboard', () => {
  beforeEach(() => { jest.clearAllMocks(); mockFullyFeaturedStore(); });

  it('returns KPI dashboard → 200', async () => {
    // $queryRaw called 5 times: today, topProducts, lowStock, monthSummary, expCategories
    prisma.$queryRaw
      .mockResolvedValueOnce([{ revenue: '500.00', order_count: 10n }])
      .mockResolvedValueOnce([
        { product_name: 'Widget', total_quantity: 5n, total_revenue: '50.00' },
      ])
      .mockResolvedValueOnce([{ low_stock_count: 3n }])
      .mockResolvedValueOnce([{ revenue: '1000.00', cogs: '600.00', expenses: '0' }])
      .mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/api/v1/reports/dashboard')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      todaySales: 500,
      todayOrderCount: 10,
      lowStockCount: 3,
    });
    expect(res.body.data.topProducts).toHaveLength(1);
    expect(res.body.data.topProducts[0].productName).toBe('Widget');
  });

  it('serves cached response on second call (same token = same scope key)', async () => {
    // 5 queries per request: today, topProducts, lowStock, monthSummary, expCategories
    prisma.$queryRaw
      .mockResolvedValueOnce([{ revenue: '100.00', order_count: 2n }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ low_stock_count: 0n }])
      .mockResolvedValueOnce([{ revenue: '200.00', cogs: '100.00', expenses: '0' }])
      .mockResolvedValueOnce([]);

    const uniqueToken = signAccessToken({
      sub: `cache-test-${Date.now()}`,
      email: 'cachetest@test.com',
      role: 'STORE_ADMIN',
      storeId: `unique-store-${Date.now()}`,
    });

    // First call — populates cache
    await request(app)
      .get('/api/v1/reports/dashboard')
      .set('Authorization', `Bearer ${uniqueToken}`);

    // Second call — should hit cache, no new DB calls
    await request(app)
      .get('/api/v1/reports/dashboard')
      .set('Authorization', `Bearer ${uniqueToken}`);

    // $queryRaw called only 5 times (first request), not 10
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(5);
  });

  it('CASHIER can access their own dashboard → 200', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ revenue: '50.00', order_count: 1n }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ low_stock_count: 0n }])
      .mockResolvedValueOnce([{ revenue: '100.00', cogs: '60.00', expenses: '0' }])
      .mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/api/v1/reports/dashboard')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(200);
  });

  it('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/api/v1/reports/dashboard');
    expect(res.status).toBe(401);
  });
});

// ─── Feature gating (requireFeature) ─────────────────────────────────────────

describe('Report feature gating', () => {
  beforeEach(() => jest.clearAllMocks());

  it('blocks sales-summary with 402 when the plan lacks the "reports" feature', async () => {
    prisma.store.findUnique.mockResolvedValue({ subscriptionPlan: { features: { reports: false } } });

    const res = await request(app)
      .get('/api/v1/reports/sales-summary')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(402);
    expect(res.body.errors).toBe('FEATURE_LOCKED');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('blocks inventory-valuation with 402 when the plan lacks "analytics" even if "reports" is true', async () => {
    prisma.store.findUnique.mockResolvedValue({
      subscriptionPlan: { features: { reports: true, analytics: false } },
    });

    const res = await request(app)
      .get('/api/v1/reports/inventory-valuation')
      .set('Authorization', `Bearer ${managerToken()}`);

    expect(res.status).toBe(402);
    expect(res.body.errors).toBe('FEATURE_LOCKED');
  });

  it('blocks sales-by-branch with 402 when the plan lacks "multiBranch"', async () => {
    prisma.store.findUnique.mockResolvedValue({
      subscriptionPlan: { features: { reports: true, analytics: true, multiBranch: false } },
    });

    const res = await request(app)
      .get('/api/v1/reports/sales-by-branch')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(402);
    expect(res.body.errors).toBe('FEATURE_LOCKED');
  });

  it('dashboard is never feature-gated regardless of plan', async () => {
    prisma.store.findUnique.mockResolvedValue({ subscriptionPlan: { features: {} }, timezone: 'UTC' });
    prisma.$queryRaw
      .mockResolvedValueOnce([{ revenue: '0', order_count: 0n }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ low_stock_count: 0n }])
      .mockResolvedValueOnce([{ revenue: '0', cogs: '0', expenses: '0' }])
      .mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/api/v1/reports/dashboard')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    // Dashboard route has no requireFeature — the only store.findUnique call
    // that happens is the internal timezone lookup for "today"/"this month"
    // bucketing, which selects `timezone`, never `subscriptionPlan`.
    for (const [args] of prisma.store.findUnique.mock.calls) {
      expect((args as { select?: Record<string, unknown> }).select).not.toHaveProperty('subscriptionPlan');
    }
  });

  it('SUPER_ADMIN bypasses feature gating entirely', async () => {
    const superToken = signAccessToken({
      sub: 'super-id', email: 'super@pos.com', role: 'SUPER_ADMIN',
    });
    prisma.$queryRaw.mockResolvedValue(mockSalesSummaryRows);

    // SUPER_ADMIN must pass ?storeId= to inspect a store's reports at all
    // (unrelated tenant-scoping rule) — irrelevant to what's under test here,
    // which is that requireFeature never even queries a plan for this role.
    const res = await request(app)
      .get(`/api/v1/reports/sales-summary?storeId=${STORE_ID}`)
      .set('Authorization', `Bearer ${superToken}`);

    expect(res.status).toBe(200);
    // Same as above — any store.findUnique call here is the timezone
    // lookup, never a feature/plan check (requireFeature skips SUPER_ADMIN
    // before it would ever query one).
    for (const [args] of prisma.store.findUnique.mock.calls) {
      expect((args as { select?: Record<string, unknown> }).select).not.toHaveProperty('subscriptionPlan');
    }
  });
});

// ─── Timezone-aware date bucketing ─────────────────────────────────────────────

describe('report date-range timezone handling', () => {
  it('localMidnightUTC returns the UTC instant of local midnight for a positive-offset timezone', () => {
    // Asia/Manila is UTC+8 year-round (no DST) — local midnight on the 17th
    // is 16:00 UTC on the 16th.
    const result = localMidnightUTC('2026-09-17', 'Asia/Manila');
    expect(result.toISOString()).toBe('2026-09-16T16:00:00.000Z');
  });

  it('localMidnightUTC returns the UTC instant of local midnight for a negative-offset timezone', () => {
    // America/New_York is UTC-4 in September (EDT) — local midnight on the
    // 17th is 04:00 UTC on the 17th.
    const result = localMidnightUTC('2026-09-17', 'America/New_York');
    expect(result.toISOString()).toBe('2026-09-17T04:00:00.000Z');
  });

  it('localMidnightUTC is a no-op for UTC', () => {
    expect(localMidnightUTC('2026-09-17', 'UTC').toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });

  it('defaultDates keeps a sale near local midnight in the correct calendar day', () => {
    // A store in Asia/Manila (UTC+8) asks for "today" = 2026-09-17. A sale
    // at 2026-09-17T07:00 Manila time is 2026-09-16T23:00Z — the OLD
    // (UTC-day) boundary logic would have excluded it from "the 17th"
    // entirely; the range must start before that instant.
    const { start, end } = defaultDates('2026-09-17', '2026-09-17', 'Asia/Manila');
    const saleDuringLocalMorning = new Date('2026-09-16T23:00:00.000Z'); // 07:00 local on the 17th
    expect(saleDuringLocalMorning.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(saleDuringLocalMorning.getTime()).toBeLessThanOrEqual(end.getTime());

    // And a sale that's genuinely still "the 16th" locally must be excluded.
    const saleStillOnThe16th = new Date('2026-09-16T15:00:00.000Z'); // 23:00 local on the 16th
    expect(saleStillOnThe16th.getTime()).toBeLessThan(start.getTime());
  });

  it('startOfTodayInTz renders "today" using the given timezone, not the server process timezone', () => {
    // 2026-09-17T02:00:00Z is already the 17th in UTC but still the 16th in
    // America/Los_Angeles (UTC-7 in September, PDT).
    const reference = new Date('2026-09-17T02:00:00.000Z');
    const utcToday = startOfTodayInTz('UTC', reference);
    const laToday = startOfTodayInTz('America/Los_Angeles', reference);

    expect(utcToday.toISOString()).toBe('2026-09-17T00:00:00.000Z');
    expect(laToday.toISOString()).toBe('2026-09-16T07:00:00.000Z'); // midnight PDT on the 16th
  });
});
