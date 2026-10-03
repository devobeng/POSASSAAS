import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { cacheGet, cacheSet } from '../../utils/cache';
import type { BaseDateRangeQuery, SalesSummaryQuery, SalesByProductQuery, ExpensesSummaryQuery } from './reports.schema';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The store's report timezone, cached briefly since it's looked up on every
 *  report call and changes essentially never. SUPER_ADMIN cross-store
 *  (platform-wide) views have no single store to derive one from — UTC,
 *  same as this codebase's prior behavior everywhere, is the only sane
 *  default there. */
async function getStoreTimezone(storeId?: string): Promise<string> {
  if (!storeId) return 'UTC';
  const cacheKey = `store-tz:${storeId}`;
  const cached = await cacheGet(cacheKey);
  if (typeof cached === 'string') return cached;

  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } });
  const tz = store?.timezone ?? 'UTC';
  await cacheSet(cacheKey, tz, 5 * 60_000);
  return tz;
}

/** The UTC instant corresponding to local midnight of `dateStr` (YYYY-MM-DD)
 *  in `timeZone`. Used so a bare date from a report's date-range picker means
 *  that calendar day in the STORE's timezone, not a UTC calendar day — a
 *  store several hours off UTC would otherwise have sales near local
 *  midnight silently attributed to the wrong day's report. */
export function localMidnightUTC(dateStr: string, timeZone: string): Date {
  const naiveUTC = new Date(`${dateStr}T00:00:00.000Z`);
  if (timeZone === 'UTC') return naiveUTC;

  // Render that UTC instant as wall-clock time in timeZone, then measure how
  // far that rendering drifted from the UTC instant we started from — that
  // drift is exactly the offset needed to correct our UTC-midnight guess
  // into the real local-midnight instant (also correct across a DST change
  // on this date, since the offset is measured at this date, not today's).
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(naiveUTC);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offsetMs = asIfLocal - naiveUTC.getTime();
  return new Date(naiveUTC.getTime() - offsetMs);
}

export function dateStrInTz(reference: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(reference);
}

/** Local midnight of "today" (in timeZone) as of `reference`. */
export function startOfTodayInTz(timeZone: string, reference = new Date()): Date {
  return localMidnightUTC(dateStrInTz(reference, timeZone), timeZone);
}

/** Local midnight of the 1st of the current month (in timeZone) as of `reference`. */
export function startOfMonthInTz(timeZone: string, reference = new Date()): Date {
  const monthStr = `${dateStrInTz(reference, timeZone).slice(0, 7)}-01`;
  return localMidnightUTC(monthStr, timeZone);
}

/** expenseDate is stored as a plain SQL DATE (no time-of-day, no timezone at
 *  all) — so unlike `defaultDates` above, a bare date string here is used
 *  exactly as given, never shifted by timezone. Only the DEFAULT range (no
 *  explicit dates supplied) derives "today" from the store's timezone, so
 *  the default window still lines up with the store's actual calendar day. */
function expenseDateRangeStrs(
  startDate: string | undefined,
  endDate: string | undefined,
  timezone: string,
): { startStr: string; endStr: string } {
  const endStr = endDate
    ? endDate.slice(0, 10)
    : dateStrInTz(new Date(), timezone);
  const startStr = startDate
    ? startDate.slice(0, 10)
    : dateStrInTz(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), timezone);
  return { startStr, endStr };
}

export function defaultDates(startDate?: string, endDate?: string, timezone = 'UTC') {
  let end: Date;
  if (endDate) {
    // Bare YYYY-MM-DD means that whole calendar day in the store's
    // timezone — advance to just before the following local midnight so
    // the full local day is included.
    end = BARE_DATE.test(endDate)
      ? new Date(localMidnightUTC(endDate, timezone).getTime() + 86_400_000 - 1)
      : new Date(endDate);
  } else {
    end = new Date();
  }
  const start = startDate
    ? (BARE_DATE.test(startDate) ? localMidnightUTC(startDate, timezone) : new Date(startDate))
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
  const tz = await getStoreTimezone(storeId);
  const { start, end } = defaultDates(query.startDate, query.endDate, tz);
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
      DATE_TRUNC(${truncUnit}, o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) AS period,
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
  const tz = await getStoreTimezone(storeId);
  const { start, end } = defaultDates(query.startDate, query.endDate, tz);
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
  const tz = await getStoreTimezone(storeId);
  const { start, end } = defaultDates(query.startDate, query.endDate, tz);
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
  const tz = await getStoreTimezone(storeId);
  const { start, end } = defaultDates(query.startDate, query.endDate, tz);
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
  const tz = await getStoreTimezone(storeId);
  const { start, end } = defaultDates(query.startDate, query.endDate, tz);
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
  const tz = await getStoreTimezone(storeId);
  const { start, end } = defaultDates(query.startDate, query.endDate, tz);
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
  const tz = await getStoreTimezone(storeId);
  const { start, end } = defaultDates(query.startDate, query.endDate, tz);
  const scopedBranchId = role === 'BRANCH_MANAGER' ? branchId : query.branchId;
  const { storeFilter, branchFilter } = buildScopeFilters(
    role, userId, storeId, scopedBranchId,
  );
  const cashierFilter =
    role === 'CASHIER' ? Prisma.sql`AND o."cashierId" = ${userId}` : Prisma.empty;

  // COGS uses order_items.costPrice — the cost snapshotted at time of sale —
  // never products.costPrice (today's cost). Otherwise editing a product's
  // cost retroactively rewrites the margin on every past order that sold
  // it, and a since-deleted product would contribute zero COGS via the old
  // LEFT JOIN. Pre-migration rows have no snapshot (column added later) and
  // are unavoidably excluded from COGS — there's no historical cost to use.
  const rows = await prisma.$queryRaw<ProfitRow[]>`
    SELECT
      SUM(oi."lineTotal")                                  AS revenue,
      SUM(oi.quantity * oi."costPrice")                     AS cogs,
      SUM(oi."lineTotal") - SUM(oi.quantity * oi."costPrice") AS gross_profit,
      COUNT(DISTINCT o.id)                                  AS order_count
    FROM order_items oi
    JOIN orders   o ON o.id  = oi."orderId"
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

  const tz = await getStoreTimezone(storeId);
  // "Today" must mean the store's local calendar day, not the server
  // process's own timezone (setHours() previously used whatever TZ the
  // Node process happens to run in) — otherwise a sale near local midnight
  // lands in the wrong day's "today" KPI.
  const todayStart = startOfTodayInTz(tz);
  const todayEnd   = new Date();

  // CASHIER is included here (not just BRANCH_MANAGER) — otherwise the
  // low-stock count below is computed store-wide for a role that's
  // inherently tied to one branch, leaking other branches' stock levels.
  // The orders-based queries below don't strictly need this (cashierFilter
  // already narrows them to the caller's own orders regardless), but
  // deriving scope from the JWT consistently for restricted roles is safer
  // than relying on a second, unrelated filter to happen to cover the gap.
  const scopedBranchId = role === 'BRANCH_MANAGER' || role === 'CASHIER' ? branchId : undefined;
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
  const tz = await getStoreTimezone(storeId);
  const effectiveBranchId = role === 'BRANCH_MANAGER' ? branchId : query.branchId;

  const storeFilter  = storeId          ? Prisma.sql`AND e."storeId"  = ${storeId}`          : Prisma.empty;
  const branchFilter = effectiveBranchId ? Prisma.sql`AND e."branchId" = ${effectiveBranchId}` : Prisma.empty;
  const catFilter    = query.categoryId  ? Prisma.sql`AND e."categoryId" = ${query.categoryId}` : Prisma.empty;

  const truncUnit =
    query.groupBy === 'month' ? Prisma.sql`'month'`
    : query.groupBy === 'week' ? Prisma.sql`'week'`
    : Prisma.sql`'day'`;

  const { startStr, endStr } = expenseDateRangeStrs(query.startDate, query.endDate, tz);

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
  const tz = await getStoreTimezone(storeId);
  const { start, end } = defaultDates(query.startDate, query.endDate, tz);
  const effectiveBranchId = role === 'BRANCH_MANAGER' ? branchId : query.branchId;
  const { storeFilter, branchFilter } = buildScopeFilters(role, userId, storeId, effectiveBranchId);
  const cashierFilter = role === 'CASHIER' ? Prisma.sql`AND o."cashierId" = ${userId}` : Prisma.empty;

  const expStoreFilter  = storeId          ? Prisma.sql`AND e."storeId"  = ${storeId}`          : Prisma.empty;
  const expBranchFilter = effectiveBranchId ? Prisma.sql`AND e."branchId" = ${effectiveBranchId}` : Prisma.empty;

  const { startStr, endStr } = expenseDateRangeStrs(query.startDate, query.endDate, tz);

  const [revenueRows, expenseRows] = await Promise.all([
    prisma.$queryRaw<PnLRevenueRow[]>`
      SELECT
        COALESCE(SUM(oi."lineTotal"), 0)                       AS revenue,
        COALESCE(SUM(oi.quantity * oi."costPrice"), 0)         AS cogs,
        COUNT(DISTINCT o.id)                                   AS order_count
      FROM order_items oi
      JOIN orders   o ON o.id  = oi."orderId"
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

  const tz = await getStoreTimezone(storeId);
  // Local calendar boundaries in the store's timezone — see getDashboard above.
  const todayStart = startOfTodayInTz(tz);
  const todayEnd   = new Date();
  const monthStart = startOfMonthInTz(tz);

  // See getDashboard above — CASHIER must be branch-scoped here too, or the
  // low-stock count leaks other branches' stock levels to a role that's
  // inherently tied to one branch.
  const scopedBranchId = role === 'BRANCH_MANAGER' || role === 'CASHIER' ? branchId : undefined;
  const { storeFilter, branchFilter } = buildScopeFilters(role, userId, storeId, scopedBranchId);
  const cashierFilter = role === 'CASHIER' ? Prisma.sql`AND o."cashierId" = ${userId}` : Prisma.empty;

  const invStoreFilter  = storeId        ? Prisma.sql`AND b."storeId"  = ${storeId}`        : Prisma.empty;
  const invBranchFilter = scopedBranchId ? Prisma.sql`AND ii."branchId" = ${scopedBranchId}` : Prisma.empty;
  const expStoreFilter  = storeId        ? Prisma.sql`AND e."storeId"  = ${storeId}`        : Prisma.empty;
  const expBranchFilter = scopedBranchId ? Prisma.sql`AND e."branchId" = ${scopedBranchId}` : Prisma.empty;

  // Rendered back through the SAME timezone that produced these instants,
  // not toISOString() (which renders in UTC and would shift the calendar
  // date for any store not on UTC).
  const monthStartStr = dateStrInTz(monthStart, tz);
  const todayEndStr   = dateStrInTz(todayEnd, tz);

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
        COALESCE(SUM(oi."lineTotal"), 0)              AS revenue,
        COALESCE(SUM(oi.quantity * oi."costPrice"), 0) AS cogs,
        0::numeric                                    AS expenses
      FROM order_items oi
      JOIN orders o ON o.id = oi."orderId"
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
