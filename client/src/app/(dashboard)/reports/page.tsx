'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import {
  useSalesSummary, useSalesByProduct, useSalesByCategory,
  useSalesByCashier, useSalesByBranch, usePaymentMethods,
  useInventoryValuation, useProfit,
} from '@/hooks/api/useReports';
import { useProfitAndLoss, type PnLData } from '@/hooks/api/useExpenses';
import { useBranches } from '@/hooks/api/useBranches';
import ClientOnly from '@/components/ui/ClientOnly';
import api from '@/lib/axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer,
} from 'recharts';

type ReportKey = 'sales-summary' | 'by-product' | 'by-category' | 'by-cashier' | 'by-branch' | 'payment-methods' | 'inventory' | 'profit' | 'pnl';

const REPORT_OPTIONS: { key: ReportKey; label: string; roles?: string[] }[] = [
  { key: 'sales-summary',  label: 'Sales Summary' },
  { key: 'by-product',     label: 'By Product' },
  { key: 'by-category',    label: 'By Category' },
  { key: 'by-cashier',     label: 'By Cashier' },
  { key: 'by-branch',      label: 'By Branch',            roles: ['STORE_ADMIN', 'SUPER_ADMIN'] },
  { key: 'payment-methods', label: 'Payment Methods' },
  { key: 'inventory',      label: 'Inventory Valuation',  roles: ['STORE_ADMIN', 'BRANCH_MANAGER', 'SUPER_ADMIN'] },
  { key: 'profit',         label: 'Gross Profit',         roles: ['STORE_ADMIN', 'BRANCH_MANAGER', 'SUPER_ADMIN'] },
  { key: 'pnl',            label: 'Profit & Loss (Full)', roles: ['STORE_ADMIN', 'BRANCH_MANAGER', 'SUPER_ADMIN'] },
];

const COLOURS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6'];

function fmt(pesewas: string | number) {
  return (parseFloat(String(pesewas)) / 100).toFixed(2);
}

function isFeatureLocked(error: unknown): boolean {
  const e = error as { response?: { data?: { errors?: string } } } | null;
  return e?.response?.data?.errors === 'FEATURE_LOCKED';
}

function UpgradePrompt() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Lock className="w-8 h-8 mb-3 text-gray-300 dark:text-gray-700" />
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">This report isn&apos;t on your current plan</p>
      <p className="text-xs text-gray-400 mt-1 mb-4">Upgrade to unlock it.</p>
      <Link
        href="/select-plan"
        className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium"
      >
        View plans
      </Link>
    </div>
  );
}

export default function ReportsPage() {
  const user = useAuthStore((s) => s.user);
  const { data: branches } = useBranches();

  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.slice(0, 8) + '01';

  const [report, setReport] = useState<ReportKey>('sales-summary');
  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(today);
  const [branchId, setBranchId] = useState(user?.branchId ?? '');
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const [exporting, setExporting] = useState(false);

  const params = { startDate, endDate, branchId: branchId || undefined, groupBy };

  const role = user?.role ?? '';
  const isManagerPlus = role === 'BRANCH_MANAGER' || role === 'STORE_ADMIN' || role === 'SUPER_ADMIN';
  const isAdminPlus   = role === 'STORE_ADMIN' || role === 'SUPER_ADMIN';

  const salesSummary = useSalesSummary(params);
  const byProduct = useSalesByProduct(params);
  const byCategory = useSalesByCategory(params);
  const byCashier = useSalesByCashier(params, { enabled: isManagerPlus });
  const byBranch = useSalesByBranch({ startDate, endDate }, { enabled: isAdminPlus });
  const paymentMethods = usePaymentMethods(params);
  const inventoryValuation = useInventoryValuation({ branchId: branchId || undefined }, { enabled: isManagerPlus });
  const profitReport = useProfit(params);
  const pnlReport = useProfitAndLoss({ startDate, endDate, branchId: branchId || undefined }, { enabled: isManagerPlus });

  const activeQueryError: unknown = {
    'sales-summary': salesSummary.error,
    'by-product': byProduct.error,
    'by-category': byCategory.error,
    'by-cashier': byCashier.error,
    'by-branch': byBranch.error,
    'payment-methods': paymentMethods.error,
    'inventory': inventoryValuation.error,
    'profit': profitReport.error,
    'pnl': pnlReport.error,
  }[report];

  const availableReports = REPORT_OPTIONS.filter(
    (r) => !r.roles || r.roles.includes(user?.role ?? ''),
  );

  const handleExport = async () => {
    const endpoints: Record<ReportKey, string> = {
      'sales-summary':  '/reports/sales-summary',
      'by-product':     '/reports/sales-by-product',
      'by-category':    '/reports/sales-by-category',
      'by-cashier':     '/reports/sales-by-cashier',
      'by-branch':      '/reports/sales-by-branch',
      'payment-methods': '/reports/payment-methods',
      'inventory':      '/reports/inventory-valuation',
      'profit':         '/reports/profit',
      'pnl':            '/reports/profit-and-loss',
    };
    setExporting(true);
    try {
      const res = await api.get(endpoints[report], { params: { ...params, format: 'csv' }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${report}-${today}.csv`; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Reports</h1>
        <button onClick={handleExport} disabled={exporting} className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
          {exporting ? 'Exporting' : ' Export CSV'}
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={report} onChange={(e) => setReport(e.target.value as ReportKey)} className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
          {availableReports.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
        <span className="text-gray-400 text-xs">to</span>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
        {report === 'sales-summary' && (
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'day' | 'week' | 'month')} className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
            <option value="day">By day</option>
            <option value="week">By week</option>
            <option value="month">By month</option>
          </select>
        )}
        {user?.role !== 'CASHIER' && branches && branches.length > 1 && report !== 'by-branch' && (
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {/* Report content */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 space-y-5">
        {isFeatureLocked(activeQueryError) ? (
        <UpgradePrompt />
        ) : (
        <>
        {report === 'sales-summary' && (
          <SalesSummaryReport data={salesSummary.data} isLoading={salesSummary.isLoading} />
        )}
        {report === 'by-product' && (
          <ByProductReport data={byProduct.data} isLoading={byProduct.isLoading} />
        )}
        {report === 'by-category' && (
          <SimpleBarsReport data={byCategory.data} isLoading={byCategory.isLoading} nameKey="categoryName" />
        )}
        {report === 'by-cashier' && (
          <SimpleBarsReport data={byCashier.data} isLoading={byCashier.isLoading} nameKey="cashierName" />
        )}
        {report === 'by-branch' && (
          <SimpleBarsReport data={byBranch.data} isLoading={byBranch.isLoading} nameKey="branchName" />
        )}
        {report === 'payment-methods' && (
          <PaymentMethodsReport data={paymentMethods.data} isLoading={paymentMethods.isLoading} />
        )}
        {report === 'inventory' && (
          <InventoryReport data={inventoryValuation.data} isLoading={inventoryValuation.isLoading} />
        )}
        {report === 'profit' && (
          <ProfitReport data={profitReport.data} isLoading={profitReport.isLoading} />
        )}
        {report === 'pnl' && (
          <ProfitAndLossReport
            data={pnlReport.data}
            isLoading={pnlReport.isLoading}
            startDate={startDate}
            endDate={endDate}
          />
        )}
        </>
        )}
      </div>
    </div>
  );
}

// ── Sub-reports ───────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((n) => <div key={n} className="h-8 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />)}
    </div>
  );
}

type SalesSummaryRow = { period: string; revenue: number; orderCount: number; taxTotal: number; discountTotal: number; avgOrderValue: number };
function SalesSummaryReport({ data, isLoading }: { data: unknown; isLoading: boolean }) {
  if (isLoading) return <LoadingState />;
  const rows = (data as { data: SalesSummaryRow[] } | undefined)?.data ?? [];
  if (!rows.length) return <p className="text-gray-400 text-sm">No data for this period</p>;
  const totRevenue  = rows.reduce((s, r) => s + r.revenue, 0);
  const totOrders   = rows.reduce((s, r) => s + r.orderCount, 0);
  const totTax      = rows.reduce((s, r) => s + r.taxTotal, 0);
  const totDiscount = rows.reduce((s, r) => s + r.discountTotal, 0);
  const avgOrder    = totOrders > 0 ? totRevenue / totOrders : 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Revenue',        val: `GHS ${fmt(totRevenue)}` },
          { label: 'Orders',         val: String(totOrders) },
          { label: 'Avg order',      val: `GHS ${fmt(avgOrder)}` },
          { label: 'Tax collected',  val: `GHS ${fmt(totTax)}` },
          { label: 'Discounts',      val: `GHS ${fmt(totDiscount)}` },
        ].map((k) => (
          <div key={k.label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{k.label}</p>
            <p className="font-bold text-gray-900 dark:text-gray-100 mt-0.5">{k.val}</p>
          </div>
        ))}
      </div>
      <ClientOnly>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} tickFormatter={(v) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 100).toFixed(0)}`} />
            <Tooltip formatter={(v) => `GHS ${(Number(v) / 100).toFixed(2)}`} />
            <Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} dot={false} name="Revenue" />
          </LineChart>
        </ResponsiveContainer>
      </ClientOnly>
    </div>
  );
}

type ByProductRow = { productId: string | null; productName: string; totalQuantity: number; totalRevenue: number };
function ByProductReport({ data, isLoading }: { data: unknown; isLoading: boolean }) {
  if (isLoading) return <LoadingState />;
  const rows = (data as { data: ByProductRow[] } | undefined)?.data ?? [];
  if (!rows.length) return <p className="text-gray-400 text-sm">No data for this period</p>;
  return (
    <div className="space-y-4">
      <ClientOnly>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows.slice(0, 10)} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tickFormatter={(v) => `${(v / 100).toFixed(0)}`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="productName" width={120} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => `GHS ${(Number(v) / 100).toFixed(2)}`} />
            <Bar dataKey="totalRevenue" fill="#6366f1" name="Revenue" />
          </BarChart>
        </ResponsiveContainer>
      </ClientOnly>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500">
          <th className="pb-2">Product</th><th className="pb-2 text-right">Qty sold</th><th className="pb-2 text-right">Revenue</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.productName} className="border-b border-gray-50 dark:border-gray-800/50">
              <td className="py-1.5">{r.productName}</td>
              <td className="py-1.5 text-right font-mono">{r.totalQuantity}</td>
              <td className="py-1.5 text-right font-mono">GHS {fmt(r.totalRevenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimpleBarsReport({ data, isLoading, nameKey }: { data: unknown; isLoading: boolean; nameKey: string }) {
  if (isLoading) return <LoadingState />;
  // Use `any` to avoid TSX parser ambiguity with typed object-cast + array type suffix
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] | undefined = (data as any)?.data;
  if (!rows || rows.length === 0) return <p className="text-gray-400 text-sm">No data</p>;
  return (
    <div className="space-y-4">
      <ClientOnly>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={nameKey} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => `${(v / 100).toFixed(0)}`} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => `GHS ${(Number(v) / 100).toFixed(2)}`} />
            <Bar dataKey="revenue" fill="#6366f1" name="Revenue" />
          </BarChart>
        </ResponsiveContainer>
      </ClientOnly>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500">
          <th className="pb-2">Name</th><th className="pb-2 text-right">Orders</th><th className="pb-2 text-right">Revenue</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const vol = String(r.orderCount != null ? r.orderCount : r.totalQuantity != null ? r.totalQuantity : '-');
            const rev = Number(r.totalRevenue != null ? r.totalRevenue : r.revenue != null ? r.revenue : 0);
            const name = String(r[nameKey] != null ? r[nameKey] : '-');
            return (
              <tr key={i} className="border-b border-gray-50 dark:border-gray-800/50">
                <td className="py-1.5">{name}</td>
                <td className="py-1.5 text-right font-mono">{vol}</td>
                <td className="py-1.5 text-right font-mono">GHS {fmt(rev)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PaymentMethodsReport({ data, isLoading }: { data: unknown; isLoading: boolean }) {
  if (isLoading) return <LoadingState />;
  const rows = (data as { data: { method: string; totalAmount: number; transactionCount: number }[] } | undefined)?.data;
  if (!rows?.length) return <p className="text-gray-400 text-sm">No data</p>;
  return (
    <div className="flex flex-col sm:flex-row gap-6 items-start">
      <ClientOnly>
        <ResponsiveContainer width={200} height={200}>
          <PieChart>
            <Pie data={rows} dataKey="totalAmount" nameKey="method" cx="50%" cy="50%" outerRadius={80}>
              {rows.map((_, i) => <Cell key={i} fill={COLOURS[i % COLOURS.length]} />)}
            </Pie>
            <Tooltip formatter={(v) => `GHS ${(Number(v) / 100).toFixed(2)}`} />
          </PieChart>
        </ResponsiveContainer>
      </ClientOnly>
      <table className="flex-1 text-sm">
        <thead><tr className="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500">
          <th className="pb-2">Method</th><th className="pb-2 text-right">Transactions</th><th className="pb-2 text-right">Amount</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.method} className="border-b border-gray-50 dark:border-gray-800/50">
              <td className="py-1.5">{r.method.replace('_', ' ')}</td>
              <td className="py-1.5 text-right font-mono">{r.transactionCount}</td>
              <td className="py-1.5 text-right font-mono">GHS {fmt(r.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type InvRow = { productName: string; totalQuantity: number; costValue: number; sellingValue: number };
function InventoryReport({ data, isLoading }: { data: unknown; isLoading: boolean }) {
  if (isLoading) return <LoadingState />;
  const d = (data as { data: { items: InvRow[]; totals: { totalCostValue: number; totalSellingValue: number } } } | undefined)?.data;
  const rows = d?.items ?? [];
  if (!rows.length) return <p className="text-gray-400 text-sm">No data</p>;
  const totCost = d?.totals?.totalCostValue ?? rows.reduce((a, r) => a + r.costValue, 0);
  const totSell = d?.totals?.totalSellingValue ?? rows.reduce((a, r) => a + r.sellingValue, 0);
  return (
    <div className="space-y-3">
      <div className="flex gap-4 flex-wrap text-sm">
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-2"><span className="text-gray-400">Cost value </span><strong>GHS {fmt(totCost)}</strong></div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-2"><span className="text-gray-400">Selling value </span><strong>GHS {fmt(totSell)}</strong></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500">
            <th className="pb-2">Product</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Cost val.</th><th className="pb-2 text-right">Sell val.</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productName} className="border-b border-gray-50 dark:border-gray-800/50">
                <td className="py-1.5">{r.productName}</td>
                <td className="py-1.5 text-right font-mono">{r.totalQuantity}</td>
                <td className="py-1.5 text-right font-mono">GHS {fmt(r.costValue)}</td>
                <td className="py-1.5 text-right font-mono">GHS {fmt(r.sellingValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProfitReport({ data, isLoading }: { data: unknown; isLoading: boolean }) {
  if (isLoading) return <LoadingState />;
  const d = (data as { data: { revenue: number; cogs: number; grossProfit: number; margin: number } } | undefined)?.data;
  if (!d) return <p className="text-gray-400 text-sm">No data</p>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'Revenue',      val: `GHS ${fmt(d.revenue)}` },
        { label: 'COGS',         val: `GHS ${fmt(d.cogs)}` },
        { label: 'Gross profit', val: `GHS ${fmt(d.grossProfit)}` },
        { label: 'Margin',       val: `${d.margin.toFixed(1)}%` },
      ].map((k) => (
        <div key={k.label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">{k.label}</p>
          <p className="font-bold text-gray-900 dark:text-gray-100 mt-0.5">{k.val}</p>
        </div>
      ))}
    </div>
  );
}

// ── Profit & Loss Statement ────────────────────────────────────────────────────

function PnlRow({
  label, value, indent, bold, separator, negative,
}: {
  label?: string; value?: string; indent?: boolean; bold?: boolean; separator?: boolean; negative?: boolean;
}) {
  if (separator) {
    return <tr><td colSpan={2}><div className="border-t border-gray-200 dark:border-gray-700 my-1" /></td></tr>;
  }
  return (
    <tr>
      <td className={`py-1.5 text-sm ${indent ? 'pl-6 text-gray-500 dark:text-gray-400' : bold ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}>
        {label}
      </td>
      <td className={`py-1.5 text-sm text-right tabular-nums ${bold ? 'font-bold' : ''} ${negative ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
        {value ?? ''}
      </td>
    </tr>
  );
}

function ProfitAndLossReport({
  data, isLoading, startDate, endDate,
}: { data: PnLData | undefined; isLoading: boolean; startDate: string; endDate: string }) {
  if (isLoading) return <LoadingState />;
  if (!data) return <p className="text-gray-400 text-sm">No data for this period</p>;

  const {
    revenue, cogs, grossProfit, grossMarginPct,
    totalExpenses, netProfit, netMarginPct,
    orderCount, expensesByCategory,
  } = data;

  const fmtN = (n: number) => `GHS ${fmt(n)}`;
  const pct  = (n: number) => `${n.toFixed(1)}%`;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Period header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Profit &amp; Loss Statement
        </h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {new Date(startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          {' — '}
          {new Date(endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <tbody>
            {/* Revenue */}
            <PnlRow label="Revenue (sales)" value={fmtN(revenue)} bold />
            <PnlRow label={`Cost of goods sold (${orderCount} orders)`} value={`(${fmtN(cogs)})`} indent />
            <PnlRow separator />
            <PnlRow label="Gross profit" value={fmtN(grossProfit)} bold />
            <PnlRow label="Gross margin" value={pct(grossMarginPct)} indent />

            {/* Operating expenses */}
            <PnlRow separator />
            <PnlRow label="Operating expenses" bold />
            {expensesByCategory.map((e) => (
              <PnlRow key={e.categoryId} label={e.categoryName} value={`(${fmtN(e.totalAmount)})`} indent />
            ))}
            {expensesByCategory.length === 0 && (
              <PnlRow label="No approved expenses in period" indent />
            )}
            <PnlRow separator />
            <PnlRow label="Total expenses" value={`(${fmtN(totalExpenses)})`} bold />

            {/* Net profit */}
            <PnlRow separator />
            <PnlRow
              label="Net profit"
              value={fmtN(netProfit)}
              bold
              negative={netProfit < 0}
            />
            <PnlRow label="Net margin" value={pct(netMarginPct)} indent negative={netMarginPct < 0} />
          </tbody>
        </table>
      </div>

      {/* Summary KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Revenue',        val: fmtN(revenue),     neg: false },
          { label: 'Gross profit',   val: fmtN(grossProfit), neg: grossProfit < 0 },
          { label: 'Total expenses', val: fmtN(totalExpenses), neg: false },
          { label: 'Net profit',     val: fmtN(netProfit),   neg: netProfit < 0 },
          { label: 'Gross margin',   val: pct(grossMarginPct), neg: grossMarginPct < 0 },
          { label: 'Net margin',     val: pct(netMarginPct),   neg: netMarginPct < 0 },
        ].map((k) => (
          <div key={k.label} className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{k.label}</p>
            <p className={`font-bold mt-0.5 text-sm ${k.neg ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
              {k.val}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}


