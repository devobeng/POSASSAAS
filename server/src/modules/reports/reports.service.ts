import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { cacheGet, cacheSet } from '../../utils/cache';
import type { BaseDateRangeQuery, SalesSummaryQuery, SalesByProductQuery, ExpensesSummaryQuery } from './reports.schema';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultDates(startDate?: string, endDate?: string) {
  let end: Date;
  if (endDate) {
    end = new Date(endDate);
    // Bare YYYY-MM-DD parses as midnight UTC — advance to end of day so the full day is included
    if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      end = new Date(end.getTime() + 86_400_000 - 1);
    }
  } else {
    end = new Date();
  }
  const start = startDate
    ? new Date(startDate)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Converts COUNT() bigint and Decimal strings coming from raw SQL to plain numbers. */
function n(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'bigint') return Number(v);
  return parseFloat(String(v));
}

interface ScopeFilters {
  storeFilter: Prisma.Sql;
  branchFilter: Prisma.Sql;
  cashierFilter: Prisma.Sql;
}

// All column names are camelCase (no @map on Prisma fields) — must quote them in raw SQL.
function buildScopeFilters(
  role: string,
  userId: string,
  storeId?: string,
  branchId?: string,
): ScopeFilters {
  return {
    storeFilter:  storeId  ? Prisma.sql`AND o."storeId"  = ${storeId}`  : Prisma.empty,
    branchFilter: branchId
      ? Prisma.sql`AND o."branchId" = ${branchId}`
      : role === 'BRANCH_MANAGER'
      ? Prisma.sql`AND o."branchId" = ${branchId ?? ''}`
      : Prisma.empty,
    cashierFilter: role === 'CASHIER' ? Prisma.sql`AND o."cashierId" = ${userId}` : Prisma.empty,
  };
}

// ─── Sales Summary ────────────────────────────────────────────────────────────

interface SalesSummaryRow {
  period: Date;
  order_count: bigint;
  revenue: string;
  tax_total: string;
  discount_total: string;
  avg_order_value: string;
}

export async function getSalesSummary(
  role: string,
  userId: string,
  storeId: string | undefined,
  branchId: string | undefined,
  query: SalesSummaryQuery,
) {
  const { start, end } = defaultDates(query.startDate, query.endDate);
  const scopedBranchId = role === 'BRANCH_MANAGER' ? branchId : query.branchId;
  const { storeFilter, branchFilter, cashierFilter } = buildScopeFilters(
    role, userId, storeId, scopedBranchId,
  );

  const truncUnit =
    query.groupBy === 'month' ? Prisma.sql`'month'`
    : query.groupBy === 'week' ? Prisma.sql`'week'`
    : Prisma.sql`'day'`;

  const rows = await prisma.$queryRaw<SalesSummaryRow[]>`
    SELECT
      DATE_TRUNC(${truncUnit}, o."createdAt") AS period,
      COUNT(o.id)                             AS order_count,
      SUM(o."grandTotal")                     AS revenue,
      SUM(o."taxTotal")                       AS tax_total,
      SUM(o."discountTotal")                  AS discount_total,
      AVG(o."grandTotal")                     AS avg_order_value
    FROM orders o
    WHERE o.status = 'COMPLETED'
      AND o."createdAt" >= ${start}
      AND o."createdAt" <= ${end}
      ${storeFilter}
      ${branchFilter}
      ${cashierFilter}
    GROUP BY period
    ORDER BY period ASC
  `;

  return rows.map((r) => ({
    period:        r.period,
    orderCount:    n(r.order_count),
    revenue:       n(r.revenue),
    taxTotal:      n(r.tax_total),
    discountTotal: n(r.discount_total),
    avgOrderValue: n(r.avg_order_value),
  }));
}

// ─── Sales by Product ─────────────────────────────────────────────────────────

interface SalesByProductRow {
  product_id: string | null;
  product_name: string;
  total_quantity: bigint;
  total_revenue: string;
}

export async function getSalesByProduct(
  role: string,
  userId: string,
  storeId: string | undefined,
  branchId: string | undefined,
  query: SalesByProductQuery,
) {
  const { start, end } = defaultDates(query.startDate, query.endDate);
  const scopedBranchId = role === 'BRANCH_MANAGER' ? branchId : query.branchId;
  const { storeFilter, branchFilter, cashierFilter } = buildScopeFilters(
    role, userId, storeId, scopedBranchId,
  );

  const rows = await prisma.$queryRaw<SalesByProductRow[]>`
    SELECT
      oi."productId"              AS product_id,
      oi."productName"            AS product_name,
      SUM(oi.quantity)            AS total_quantity,
      SUM(oi."lineTotal")         AS total_revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi."orderId"
    WHERE o.status = 'COMPLETED'
      AND o."createdAt" >= ${start}
      AND o."createdAt" <= ${end}
      ${storeFilter}
      ${branchFilter}
      ${cashierFilter}
    GROUP BY oi."productId", oi."productName"
    ORDER BY total_revenue DESC
    LIMIT ${query.limit}
  `;

  return rows.map((r) => ({
    productId:     r.product_id,
    productName:   r.product_name,
    totalQuantity: n(r.total_quantity),
    totalRevenue:  n(r.total_revenue),
  }));
}

// ─── Sales by Category ────────────────────────────────────────────────────────

interface SalesByCategoryRow {
  category_id: string;
  category_name: string;
  total_quantity: bigint;
  total_revenue: string;
}

export async function getSalesByCategory(
  role: string,
  userId: string,
  storeId: string | undefined,
  branchId: string | undefined,
  query: BaseDateRangeQuery,
) {
  const { start, end } = defaultDates(query.startDate, query.endDate);
  const scopedBranchId = role === 'BRANCH_MANAGER' ? branchId : query.branchId;
  const { storeFilter, branchFilter, cashierFilter } = buildScopeFilters(
    role, userId, storeId, scopedBranchId,
  );

  const rows = await prisma.$queryRaw<SalesByCategoryRow[]>`
    SELECT
      c.id               AS category_id,
      c.name             AS category_name,
      SUM(oi.quantity)   AS total_quantity,
      SUM(oi."lineTotal") AS total_revenue
    FROM order_items oi
    JOIN orders     o ON o.id  = oi."orderId"
    JOIN products   p ON p.id  = oi."productId"
    JOIN categories c ON c.id  = p."categoryId"
    WHERE o.status = 'COMPLETED'
      AND o."createdAt" >= ${start}
      AND o."createdAt" <= ${end}
      ${storeFilter}
      ${branchFilter}
      ${cashierFilter}
    GROUP BY c.id, c.name
    ORDER BY total_revenue DESC
  `;

  return rows.map((r) => ({
    categoryId:    r.category_id,
    categoryName:  r.category_name,
    totalQuantity: n(r.total_quantity),
    totalRevenue:  n(r.total_revenue),
  }));
}

// ─── Sales by Cashier ─────────────────────────────────────────────────────────

interface SalesByCashierRow {
  cashier_id: string;
  cashier_name: string;
  order_count: bigint;
  revenue: string;
  avg_order_value: string;
}

export async function getSalesByCashier(
  role: string,
  userId: string,
  storeId: string | undefined,
  branchId: string | undefined,
  query: BaseDateRangeQuery,
) {
  const { start, end } = defaultDates(query.startDate, query.endDate);
  const scopedBranchId = role === 'BRANCH_MANAGER' ? branchId : query.branchId;
  const { storeFilter, branchFilter } = buildScopeFilters(
    role, userId, storeId, scopedBranchId,
  );
  const cashierFilter =
    role === 'CASHIER' ? Prisma.sql`AND o."cashierId" = ${userId}` : Prisma.empty;

  const rows = await prisma.$queryRaw<SalesByCashierRow[]>`
    SELECT
      u.id                AS cashier_id,
      u.name              AS cashier_name,
      COUNT(o.id)         AS order_count,
      SUM(o."grandTotal") AS revenue,
      AVG(o."grandTotal") AS avg_order_value
    FROM orders o
    JOIN users u ON u.id = o."cashierId"
    WHERE o.status = 'COMPLETED'
      AND o."createdAt" >= ${start}
      AND o."createdAt" <= ${end}
      ${storeFilter}
      ${branchFilter}
      ${cashierFilter}
    GROUP BY u.id, u.name
    ORDER BY revenue DESC
  `;

  return rows.map((r) => ({
    cashierId:     r.cashier_id,
    cashierName:   r.cashier_name,
    orderCount:    n(r.order_count),
    revenue:       n(r.revenue),
    avgOrderValue: n(r.avg_order_value),
  }));
}

// ─── Sales by Branch ──────────────────────────────────────────────────────────

interface SalesByBranchRow {
  branch_id: string;
  branch_name: string;
  order_count: bigint;
  revenue: string;
}

export async function getSalesByBranch(
  storeId: string | undefined,
  query: BaseDateRangeQuery,
) {
  const { start, end } = defaultDates(query.startDate, query.endDate);
  const storeFilter = storeId ? Prisma.sql`AND o."storeId" = ${storeId}` : Prisma.empty;

  const rows = await prisma.$queryRaw<SalesByBranchRow[]>`
    SELECT
      b.id                AS branch_id,
      b.name              AS branch_name,
      COUNT(o.id)         AS order_count,
      SUM(o."grandTotal") AS revenue
    FROM orders o
    JOIN branches b ON b.id = o."branchId"
    WHERE o.status = 'COMPLETED'
      AND o."createdAt" >= ${start}
      AND o."createdAt" <= ${end}
      ${storeFilter}
    GROUP BY b.id, b.name
    ORDER BY revenue DESC
  `;

  return rows.map((r) => ({
    branchId:   r.branch_id,
    branchName: r.branch_name,
    orderCount: n(r.order_count),
    revenue:    n(r.revenue),
  }));
}

// ─── Payment Methods Breakdown ────────────────────────────────────────────────

interface PaymentMethodRow {
  method: string;
  transaction_count: bigint;
  total_amount: string;
}

export async function getPaymentMethodsBreakdown(
  role: string,
  userId: string,
  storeId: string | undefined,
  branchId: string | undefined,
  query: BaseDateRangeQuery,
) {
  const { start, end } = defaultDates(query.startDate, query.endDate);
  const scopedBranchId = role === 'BRANCH_MANAGER' ? branchId : query.branchId;
  const { storeFilter, branchFilter } = buildScopeFilters(
    role, userId, storeId, scopedBranchId,
  );
  const cashierFilter =
    role === 'CASHIER' ? Prisma.sql`AND o."cashierId" = ${userId}` : Prisma.empty;

  const rows = await prisma.$queryRaw<PaymentMethodRow[]>`
    SELECT
      p.method,
      COUNT(p.id)   AS transaction_count,
      SUM(p.amount) AS total_amount
    FROM payments p
    JOIN orders o ON o.id = p."orderId"
    WHERE p.status = 'SUCCESS'
      AND o."createdAt" >= ${start}
      AND o."createdAt" <= ${end}
      ${storeFilter}
      ${branchFilter}
      ${cashierFilter}
    GROUP BY p.method
    ORDER BY total_amount DESC
  `;

  return rows.map((r) => ({
    method:           r.method,
    transactionCount: n(r.transaction_count),
    totalAmount:      n(r.total_amount),
  }));
}

// ─── Inventory Valuation ──────────────────────────────────────────────────────

interface InventoryValuationRow {
  product_id: string;
  product_name: string;
  sku: string;
  total_quantity: bigint;
  cost_price: string;
  selling_price: string;
  cost_value: string;
  selling_value: string;
}

export async function getInventoryValuation(
  storeId: string | undefined,
  branchId: string | undefined,
) {
  const storeFilter  = storeId  ? Prisma.sql`AND b."storeId"  = ${storeId}`  : Prisma.empty;
  const branchFilter = branchId ? Prisma.sql`AND ii."branchId" = ${branchId}` : Prisma.empty;

  const rows = await prisma.$queryRaw<InventoryValuationRow[]>`
    SELECT
      p.id                                    AS product_id,
      p.name                                  AS product_name,
      p.sku,
      SUM(ii.quantity)                        AS total_quantity,
      p."costPrice"                           AS cost_price,
      p."sellingPrice"                        AS selling_price,
      SUM(ii.quantity) * p."costPrice"        AS cost_value,
      SUM(ii.quantity) * p."sellingPrice"     AS selling_value
    FROM inventory_items ii
    JOIN products p ON p.id  = ii."productId"
    JOIN branches b ON b.id  = ii."branchId"
    WHERE p."isActive" = true
      ${storeFilter}
      ${branchFilter}
    GROUP BY p.id, p.name, p.sku, p."costPrice", p."sellingPrice"
    ORDER BY cost_value DESC
  `;

  const totals = rows.reduce(
    (acc, r) => ({
      totalCostValue:    acc.totalCostValue    + n(r.cost_value),
      totalSellingValue: acc.totalSellingValue + n(r.selling_value),
    }),
    { totalCostValue: 0, totalSellingValue: 0 },
  );

  return {
    items: rows.map((r) => ({
      productId:    r.product_id,
      productName:  r.product_name,
      sku:          r.sku,
      totalQuantity: n(r.total_quantity),
      costPrice:    n(r.cost_price),
      sellingPrice: n(r.selling_price),
      costValue:    n(r.cost_value),
      sellingValue: n(r.selling_value),
    })),
    totals,
  };
}

// ─── Profit ───────────────────────────────────────────────────────────────────

interface ProfitRow {
  revenue: string;
  cogs: string;
  gross_profit: string;
  order_count: bigint;
}

export async function getProfit(
  role: string,
  userId: string,
  storeId: string | undefined,
  branchId: string | undefined,
  query: BaseDateRangeQuery,
) {
  const { start, end } = defaultDates(query.startDate, query.endDate);
  const scopedBranchId = role === 'BRANCH_MANAGER' ? branchId : query.branchId;
  const { storeFilter, branchFilter } = buildScopeFilters(
    role, userId, storeId, scopedBranchId,
  );
  const cashierFilter =
    role === 'CASHIER' ? Prisma.sql`AND o."cashierId" = ${userId}` : Prisma.empty;

  const rows = await prisma.$queryRaw<ProfitRow[]>`
    SELECT
      SUM(oi."lineTotal")                               AS revenue,
      SUM(oi.quantity * p."costPrice")                  AS cogs,
      SUM(oi."lineTotal") - SUM(oi.quantity * p."costPrice") AS gross_profit,
      COUNT(DISTINCT o.id)                              AS order_count
    FROM order_items oi
    JOIN orders   o ON o.id  = oi."orderId"
    LEFT JOIN products p ON p.id = oi."productId"
    WHERE o.status = 'COMPLETED'
      AND o."createdAt" >= ${start}
      AND o."createdAt" <= ${end}
      ${storeFilter}
      ${branchFilter}
      ${cashierFilter}
  `;

  const row = rows[0] ?? { revenue: '0', cogs: '0', gross_profit: '0', order_count: 0n };
  return {
    revenue:     n(row.revenue),
    cogs:        n(row.cogs),
    grossProfit: n(row.gross_profit),
    orderCount:  n(row.order_count),
    margin: n(row.revenue) > 0 ? (n(row.gross_profit) / n(row.revenue)) * 100 : 0,
  };
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

interface DashboardTodayRow {
  revenue: string;
  order_count: bigint;
}

interface DashboardTopProductRow {
  product_name: string;
  total_quantity: bigint;
  total_revenue: string;
}

interface DashboardLowStockRow {
  low_stock_count: bigint;
}

export async function getDashboard(
  role: string,
  userId: string,
  storeId: string | undefined,
  branchId: string | undefined,
) {
  const cacheKey = `dashboard:${storeId ?? 'all'}:${branchId ?? 'all'}:${role === 'CASHIER' ? userId : ''}`;
  const cached = await cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date();

  const scopedBranchId = role === 'BRANCH_MANAGER' ? branchId : undefined;
  const { storeFilter, branchFilter } = buildScopeFilters(role, userId, storeId, scopedBranchId);
  const cashierFilter = role === 'CASHIER' ? Prisma.sql`AND o."cashierId" = ${userId}` : Prisma.empty;

  const invStoreFilter  = storeId        ? Prisma.sql`AND b."storeId"  = ${storeId}`        : Prisma.empty;
  const invBranchFilter = scopedBranchId ? Prisma.sql`AND ii."branchId" = ${scopedBranchId}` : Prisma.empty;

  const [todayRows, topProductRows, lowStockRows] = await Promise.all([
    prisma.$queryRaw<DashboardTodayRow[]>`
      SELECT
        COALESCE(SUM(o."grandTotal"), 0) AS revenue,
        COUNT(o.id)                      AS order_count
      FROM orders o
      WHERE o.status = 'COMPLETED'
        AND o."createdAt" >= ${todayStart}
        AND o."createdAt" <= ${todayEnd}
        ${storeFilter} ${branchFilter} ${cashierFilter}
    `,
    prisma.$queryRaw<DashboardTopProductRow[]>`
      SELECT
        oi."productName",
        SUM(oi.quantity)    AS total_quantity,
        SUM(oi."lineTotal") AS total_revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi."orderId"
      WHERE o.status = 'COMPLETED'
        AND o."createdAt" >= ${todayStart}
        AND o."createdAt" <= ${todayEnd}
        ${storeFilter} ${branchFilter} ${cashierFilter}
      GROUP BY oi."productName"
      ORDER BY total_revenue DESC
      LIMIT 5
    `,
    prisma.$queryRaw<DashboardLowStockRow[]>`
      SELECT COUNT(*) AS low_stock_count
      FROM inventory_items ii
      JOIN branches b ON b.id = ii."branchId"
      WHERE ii.quantity <= ii."lowStockThreshold"
        ${invStoreFilter} ${invBranchFilter}
    `,
  ]);

  const today = todayRows[0] ?? { revenue: '0', order_count: 0n };
  const result = {
    todaySales:      n(today.revenue),
    todayOrderCount: n(today.order_count),
    lowStockCount:   n(lowStockRows[0]?.low_stock_count ?? 0n),
    topProducts: topProductRows.map((r) => ({
      productName:   r.product_name,
      totalQuantity: n(r.total_quantity),
      totalRevenue:  n(r.total_revenue),
    })),
  };

  await cacheSet(cacheKey, result, 60_000);
  return result;
}

// ─── Expenses Summary ─────────────────────────────────────────────────────────

interface ExpensesByCategoryRow {
  category_id:   string;
  category_name: string;
  total_amount:  string;
  expense_count: bigint;
}

interface ExpensesByPeriodRow {
  period:        Date;
  total_amount:  string;
  expense_count: bigint;
}

export async function getExpensesSummary(
  storeId: string | undefined,
  branchId: string | undefined,
  role: string,
  query: ExpensesSummaryQuery,
) {
  const { start, end } = defaultDates(query.startDate, query.endDate);
  const effectiveBranchId = role === 'BRANCH_MANAGER' ? branchId : query.branchId;

  const storeFilter  = storeId          ? Prisma.sql`AND e."storeId"  = ${storeId}`          : Prisma.empty;
  const branchFilter = effectiveBranchId ? Prisma.sql`AND e."branchId" = ${effectiveBranchId}` : Prisma.empty;
  const catFilter    = query.categoryId  ? Prisma.sql`AND e."categoryId" = ${query.categoryId}` : Prisma.empty;

  const truncUnit =
    query.groupBy === 'month' ? Prisma.sql`'month'`
    : query.groupBy === 'week' ? Prisma.sql`'week'`
    : Prisma.sql`'day'`;

  const startStr = start.toISOString().split('T')[0];
  const endStr   = end.toISOString().split('T')[0];

  const [byCategory, byPeriod] = await Promise.all([
    prisma.$queryRaw<ExpensesByCategoryRow[]>`
      SELECT
        ec.id         AS category_id,
        ec.name       AS category_name,
        SUM(e.amount) AS total_amount,
        COUNT(e.id)   AS expense_count
      FROM expenses e
      JOIN expense_categories ec ON ec.id = e."categoryId"
      WHERE e.status = 'APPROVED'
        AND e."expenseDate" >= ${startStr}::date
        AND e."expenseDate" <= ${endStr}::date
        ${storeFilter}
        ${branchFilter}
        ${catFilter}
      GROUP BY ec.id, ec.name
      ORDER BY total_amount DESC
    `,
    prisma.$queryRaw<ExpensesByPeriodRow[]>`
      SELECT
        DATE_TRUNC(${truncUnit}, e."expenseDate"::timestamp) AS period,
        SUM(e.amount) AS total_amount,
        COUNT(e.id)   AS expense_count
      FROM expenses e
      WHERE e.status = 'APPROVED'
        AND e."expenseDate" >= ${startStr}::date
        AND e."expenseDate" <= ${endStr}::date
        ${storeFilter}
        ${branchFilter}
        ${catFilter}
      GROUP BY period
      ORDER BY period ASC
    `,
  ]);

  const grandTotal = byCategory.reduce((sum, r) => sum + n(r.total_amount), 0);

  return {
    grandTotal,
    byCategory: byCategory.map((r) => ({
      categoryId:   r.category_id,
      categoryName: r.category_name,
      totalAmount:  n(r.total_amount),
      expenseCount: n(r.expense_count),
      share: grandTotal > 0 ? (n(r.total_amount) / grandTotal) * 100 : 0,
    })),
    byPeriod: byPeriod.map((r) => ({
      period:       r.period,
      totalAmount:  n(r.total_amount),
      expenseCount: n(r.expense_count),
    })),
  };
}

// ─── Profit & Loss ────────────────────────────────────────────────────────────

interface PnLRevenueRow {
  revenue:     string;
  cogs:        string;
  order_count: bigint;
}

interface PnLExpenseCategoryRow {
  category_id:   string;
  category_name: string;
  total_amount:  string;
}

export async function getProfitAndLoss(
  role: string,
  userId: string,
  storeId: string | undefined,
  branchId: string | undefined,
  query: BaseDateRangeQuery,
) {
  const { start, end } = defaultDates(query.startDate, query.endDate);
  const effectiveBranchId = role === 'BRANCH_MANAGER' ? branchId : query.branchId;
  const { storeFilter, branchFilter } = buildScopeFilters(role, userId, storeId, effectiveBranchId);
  const cashierFilter = role === 'CASHIER' ? Prisma.sql`AND o."cashierId" = ${userId}` : Prisma.empty;

  const expStoreFilter  = storeId          ? Prisma.sql`AND e."storeId"  = ${storeId}`          : Prisma.empty;
  const expBranchFilter = effectiveBranchId ? Prisma.sql`AND e."branchId" = ${effectiveBranchId}` : Prisma.empty;

  const startStr = start.toISOString().split('T')[0];
  const endStr   = end.toISOString().split('T')[0];

  const [revenueRows, expenseRows] = await Promise.all([
    prisma.$queryRaw<PnLRevenueRow[]>`
      SELECT
        COALESCE(SUM(oi."lineTotal"), 0)                       AS revenue,
        COALESCE(SUM(oi.quantity * p."costPrice"), 0)          AS cogs,
        COUNT(DISTINCT o.id)                                   AS order_count
      FROM order_items oi
      JOIN orders   o ON o.id  = oi."orderId"
      LEFT JOIN products p ON p.id = oi."productId"
      WHERE o.status = 'COMPLETED'
        AND o."createdAt" >= ${start}
        AND o."createdAt" <= ${end}
        ${storeFilter}
        ${branchFilter}
        ${cashierFilter}
    `,
    prisma.$queryRaw<PnLExpenseCategoryRow[]>`
      SELECT
        ec.id         AS category_id,
        ec.name       AS category_name,
        SUM(e.amount) AS total_amount
      FROM expenses e
      JOIN expense_categories ec ON ec.id = e."categoryId"
      WHERE e.status = 'APPROVED'
        AND e."expenseDate" >= ${startStr}::date
        AND e."expenseDate" <= ${endStr}::date
        ${expStoreFilter}
        ${expBranchFilter}
      GROUP BY ec.id, ec.name
      ORDER BY total_amount DESC
    `,
  ]);

  const rev         = revenueRows[0] ?? { revenue: '0', cogs: '0', order_count: 0n };
  const revenue     = n(rev.revenue);
  const cogs        = n(rev.cogs);
  const grossProfit = revenue - cogs;
  const totalExpenses = expenseRows.reduce((s, r) => s + n(r.total_amount), 0);
  const netProfit   = grossProfit - totalExpenses;

  return {
    revenue,
    cogs,
    grossProfit,
    grossMarginPct:     revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    totalExpenses,
    netProfit,
    netMarginPct:       revenue > 0 ? (netProfit   / revenue) * 100 : 0,
    orderCount:         n(rev.order_count),
    expensesByCategory: expenseRows.map((r) => ({
      categoryId:   r.category_id,
      categoryName: r.category_name,
      totalAmount:  n(r.total_amount),
    })),
  };
}

// ─── Dashboard Extended (with net profit + month expenses) ────────────────────

interface MonthSummaryRow { revenue: string; cogs: string; expenses: string; }

export async function getDashboardExtended(
  role: string,
  userId: string,
  storeId: string | undefined,
  branchId: string | undefined,
) {
  const cacheKey = `dashboard:${storeId ?? 'all'}:${branchId ?? 'all'}:${role === 'CASHIER' ? userId : ''}`;
  const cached = await cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const scopedBranchId = role === 'BRANCH_MANAGER' ? branchId : undefined;
  const { storeFilter, branchFilter } = buildScopeFilters(role, userId, storeId, scopedBranchId);
  const cashierFilter = role === 'CASHIER' ? Prisma.sql`AND o."cashierId" = ${userId}` : Prisma.empty;

  const invStoreFilter  = storeId        ? Prisma.sql`AND b."storeId"  = ${storeId}`        : Prisma.empty;
  const invBranchFilter = scopedBranchId ? Prisma.sql`AND ii."branchId" = ${scopedBranchId}` : Prisma.empty;
  const expStoreFilter  = storeId        ? Prisma.sql`AND e."storeId"  = ${storeId}`        : Prisma.empty;
  const expBranchFilter = scopedBranchId ? Prisma.sql`AND e."branchId" = ${scopedBranchId}` : Prisma.empty;

  const monthStartStr = monthStart.toISOString().split('T')[0];
  const todayEndStr   = todayEnd.toISOString().split('T')[0];

  const [todayRows, topProductRows, lowStockRows, monthSummaryRows] = await Promise.all([
    prisma.$queryRaw<DashboardTodayRow[]>`
      SELECT COALESCE(SUM(o."grandTotal"), 0) AS revenue, COUNT(o.id) AS order_count
      FROM orders o
      WHERE o.status = 'COMPLETED'
        AND o."createdAt" >= ${todayStart} AND o."createdAt" <= ${todayEnd}
        ${storeFilter} ${branchFilter} ${cashierFilter}
    `,
    prisma.$queryRaw<DashboardTopProductRow[]>`
      SELECT oi."productName", SUM(oi.quantity) AS total_quantity, SUM(oi."lineTotal") AS total_revenue
      FROM order_items oi JOIN orders o ON o.id = oi."orderId"
      WHERE o.status = 'COMPLETED'
        AND o."createdAt" >= ${todayStart} AND o."createdAt" <= ${todayEnd}
        ${storeFilter} ${branchFilter} ${cashierFilter}
      GROUP BY oi."productName" ORDER BY total_revenue DESC LIMIT 5
    `,
    prisma.$queryRaw<DashboardLowStockRow[]>`
      SELECT COUNT(*) AS low_stock_count
      FROM inventory_items ii JOIN branches b ON b.id = ii."branchId"
      WHERE ii.quantity <= ii."lowStockThreshold" ${invStoreFilter} ${invBranchFilter}
    `,
    prisma.$queryRaw<MonthSummaryRow[]>`
      SELECT
        COALESCE(SUM(oi."lineTotal"), 0)             AS revenue,
        COALESCE(SUM(oi.quantity * p."costPrice"), 0) AS cogs,
        0::numeric                                   AS expenses
      FROM order_items oi
      JOIN orders o ON o.id = oi."orderId"
      LEFT JOIN products p ON p.id = oi."productId"
      WHERE o.status = 'COMPLETED'
        AND o."createdAt" >= ${monthStart} AND o."createdAt" <= ${todayEnd}
        ${storeFilter} ${branchFilter} ${cashierFilter}
    `,
  ]);

  // Expense queries isolated — if expenses table is missing/errors, dashboard still works
  let expCatRows: PnLExpenseCategoryRow[] = [];
  try {
    expCatRows = await prisma.$queryRaw<PnLExpenseCategoryRow[]>`
      SELECT ec.id AS category_id, ec.name AS category_name, SUM(e.amount) AS total_amount
      FROM expenses e JOIN expense_categories ec ON ec.id = e."categoryId"
      WHERE e.status = 'APPROVED'
        AND e."expenseDate" >= ${monthStartStr}::date AND e."expenseDate" <= ${todayEndStr}::date
        ${expStoreFilter} ${expBranchFilter}
      GROUP BY ec.id, ec.name ORDER BY total_amount DESC
    `;
  } catch {
    // Non-fatal — expenses module may not be migrated yet
  }

  const today = todayRows[0] ?? { revenue: '0', order_count: 0n };
  const ms    = monthSummaryRows[0] ?? { revenue: '0', cogs: '0', expenses: '0' };
  const monthRevenue   = n(ms.revenue);
  const monthCogs      = n(ms.cogs);
  const monthExpenses  = expCatRows.reduce((s, r) => s + n(r.total_amount), 0);
  const monthNetProfit = monthRevenue - monthCogs - monthExpenses;

  const result = {
    todaySales:      n(today.revenue),
    todayOrderCount: n(today.order_count),
    lowStockCount:   n(lowStockRows[0]?.low_stock_count ?? 0n),
    topProducts: topProductRows.map((r) => ({
      productName:   r.product_name,
      totalQuantity: n(r.total_quantity),
      totalRevenue:  n(r.total_revenue),
    })),
    monthNetProfit,
    monthExpenses,
    expensesByCategory: expCatRows.map((r) => ({
      categoryId:   r.category_id,
      categoryName: r.category_name,
      totalAmount:  n(r.total_amount),
    })),
  };

  await cacheSet(cacheKey, result, 60_000);
  return result;
}
