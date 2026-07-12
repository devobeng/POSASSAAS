'use client';

import { useState, useMemo } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useDashboard, useSalesSummary, useSalesByProduct, usePaymentMethods } from '@/hooks/api/useReports';
import { useBranches } from '@/hooks/api/useBranches';
import ClientOnly from '@/components/ui/ClientOnly';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';

const CHART_COLOURS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

function fmt(n: number, currency = 'GHS') {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency', currency,
    notation: Math.abs(n) >= 1_000_000 ? 'compact' : 'standard',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n / 100);
}

function KpiCard({
  label, value, sub, negative,
}: { label: string; value: string | number; sub?: string; negative?: boolean }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${negative ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function ChartCard({ title, children, isLoading }: { title: string; children: React.ReactNode; isLoading?: boolean }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">{title}</h3>
      {isLoading ? <div className="h-48 bg-gray-50 dark:bg-gray-800 rounded-lg animate-pulse" /> : children}
    </div>
  );
}

export default function DashboardPage() {
  const user        = useAuthStore((s) => s.user);
  const isAdminPlus = user?.role === 'STORE_ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'BRANCH_MANAGER';

  const [selectedBranch, setSelectedBranch] = useState<string | undefined>();
  const { data: branches = [] } = useBranches();

  const { data: kpiRaw, isLoading: kpiLoading, isError } = useDashboard(
    selectedBranch ? { branchId: selectedBranch } : undefined,
  );
  const kpi = kpiRaw?.data as {
    todaySales: number;
    todayOrderCount: number;
    lowStockCount: number;
    topProducts: { productName: string; totalRevenue: number; totalQuantity: number }[];
    monthNetProfit?: number;
    monthExpenses?: number;
    expensesByCategory?: { categoryId: string; categoryName: string; totalAmount: number }[];
  } | undefined;

  // Last 30 days chart data
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  const chartParams = useMemo(() => ({
    startDate: thirtyDaysAgo.toISOString().split('T')[0],
    endDate:   today.toISOString().split('T')[0],
    groupBy:   'day' as const,
    branchId:  selectedBranch,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [selectedBranch]);

  const { data: salesData,      isLoading: salesLoading }    = useSalesSummary(chartParams);
  const { data: topProductsData, isLoading: productsLoading } = useSalesByProduct({ ...chartParams, limit: 5 });
  const { data: paymentData,    isLoading: paymentLoading }   = usePaymentMethods(chartParams);

  const salesChartData = (salesData?.data as { period: string; revenue: number }[] | undefined)?.map((d) => ({
    date:    new Date(d.period).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    revenue: d.revenue,
  })) ?? [];

  const topProductsChart = (topProductsData?.data as { productName: string; totalRevenue: number }[] | undefined)?.map((d) => ({
    name:    d.productName.length > 14 ? d.productName.slice(0, 14) + '…' : d.productName,
    revenue: d.totalRevenue,
  })) ?? [];

  const paymentChart = (paymentData?.data as { method: string; totalAmount: number }[] | undefined)?.map((d) => ({
    name:  d.method.replace('_', ' '),
    value: d.totalAmount,
  })) ?? [];

  const expenseDonut = (kpi?.expensesByCategory ?? []).map((e) => ({
    name:  e.categoryName,
    value: e.totalAmount,
  }));

  const currency = user?.store?.currency ?? 'GHS';

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Welcome back, {user?.name ?? ''}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {user?.role?.replace(/_/g, ' ')} Today&apos;s overview
          </p>
        </div>

        {isAdminPlus && branches.length > 0 && (
          <select
            value={selectedBranch ?? ''}
            onChange={(e) => setSelectedBranch(e.target.value || undefined)}
            className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {isError && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          Failed to load dashboard data.
        </div>
      )}

      {/* KPI cards — 5 cards (or 3 for cashier) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {kpiLoading ? (
          Array.from({ length: isAdminPlus ? 5 : 3 }).map((_, i) => (
            <div key={i} className="h-28 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))
        ) : (
          <>
            <KpiCard label="Today's revenue"   value={fmt(kpi?.todaySales ?? 0, currency)} />
            <KpiCard label="Orders today"       value={kpi?.todayOrderCount ?? 0} />
            <KpiCard label="Low stock alerts"   value={kpi?.lowStockCount ?? 0}
              sub={kpi?.lowStockCount ? 'items below threshold' : undefined} />
            {isAdminPlus && kpi?.monthNetProfit !== undefined && (
              <>
                <KpiCard
                  label="Net profit (MTD)"
                  value={fmt(kpi.monthNetProfit, currency)}
                  negative={kpi.monthNetProfit < 0}
                  sub="Revenue − COGS − expenses"
                />
                <KpiCard
                  label="Expenses (MTD)"
                  value={fmt(kpi.monthExpenses ?? 0, currency)}
                  sub="Approved expenses this month"
                />
              </>
            )}
          </>
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sales trend — spans 2 cols */}
        <div className="lg:col-span-2">
          <ChartCard title="Revenue for the last 30 days" isLoading={salesLoading}>
            <ClientOnly fallback={<div className="h-48 bg-gray-50 dark:bg-gray-800 rounded-lg animate-pulse" />}>
              <ResponsiveContainer width="100%" height={192}>
                <LineChart data={salesChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(Number(v) / 100).toFixed(0)}`} />
                  <Tooltip formatter={(v) => [fmt(Number(v), currency), 'Revenue']} />
                  <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ClientOnly>
          </ChartCard>
        </div>

        {/* Expenses donut (managers+) or payment methods (cashier) */}
        {isAdminPlus && expenseDonut.length > 0 ? (
          <ChartCard title="Expenses by category (MTD)" isLoading={kpiLoading}>
            <ClientOnly fallback={<div className="h-48 bg-gray-50 dark:bg-gray-800 rounded-lg animate-pulse" />}>
              <ResponsiveContainer width="100%" height={192}>
                <PieChart>
                  <Pie data={expenseDonut} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={false}>
                    {expenseDonut.map((_, i) => (
                      <Cell key={i} fill={CHART_COLOURS[i % CHART_COLOURS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => fmt(Number(v), currency)} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </ClientOnly>
          </ChartCard>
        ) : (
          <ChartCard title="Payment methods" isLoading={paymentLoading}>
            <ClientOnly fallback={<div className="h-48 bg-gray-50 dark:bg-gray-800 rounded-lg animate-pulse" />}>
              <ResponsiveContainer width="100%" height={192}>
                <PieChart>
                  <Pie data={paymentChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={false}>
                    {paymentChart.map((_, i) => (
                      <Cell key={i} fill={CHART_COLOURS[i % CHART_COLOURS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => fmt(Number(v), currency)} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </ClientOnly>
          </ChartCard>
        )}
      </div>

      {/* Top products */}
      <ChartCard title="Top 5 products (last 30 days)" isLoading={productsLoading}>
        <ClientOnly fallback={<div className="h-40 bg-gray-50 dark:bg-gray-800 rounded-lg animate-pulse" />}>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={topProductsChart} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
              <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} tickFormatter={(v) => `${(Number(v) / 100).toFixed(0)}`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={90} />
              <Tooltip formatter={(v) => [fmt(Number(v), currency), 'Revenue']} />
              <Bar dataKey="revenue" fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ClientOnly>
      </ChartCard>
    </div>
  );
}




