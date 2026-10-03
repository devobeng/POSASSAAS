'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useOrders, useOrder, useRefundOrder } from '@/hooks/api/useOrders';
import { useBranches } from '@/hooks/api/useBranches';
import { useUiStore } from '@/store/uiStore';
import { getErrorMessage } from '@/lib/errors';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Badge, { type BadgeVariant } from '@/components/ui/Badge';
import Drawer from '@/components/ui/Drawer';
import Modal from '@/components/ui/Modal';
import type { Order, OrderStatus } from '@/types';

const STATUS_VARIANT: Record<OrderStatus, BadgeVariant> = {
  PENDING: 'warning', COMPLETED: 'success', CANCELLED: 'neutral', REFUNDED: 'info',
};

export default function OrdersPage() {
  const user = useAuthStore((s) => s.user);
  const toast = useUiStore((s) => s.toast);
  const { data: branches } = useBranches();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [branchFilter, setBranchFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refundId, setRefundId] = useState<string | null>(null);

  const canRefund = user?.role === 'BRANCH_MANAGER' || user?.role === 'STORE_ADMIN' || user?.role === 'SUPER_ADMIN';

  const { data, isLoading, isError, error, refetch } = useOrders({
    page, limit: 20,
    status: statusFilter || undefined,
    branchId: branchFilter || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  });

  const { data: orderDetail, isLoading: detailLoading } = useOrder(selectedId ?? '');
  const { mutate: refundOrder, isPending: refunding } = useRefundOrder(refundId ?? '');

  const columns: Column<Order>[] = [
    { key: 'orderNumber', header: 'Order #', render: (o) => <span className="font-mono text-xs font-semibold">{o.orderNumber}</span> },
    { key: 'date', header: 'Date', render: (o) => <span className="text-xs text-gray-500">{new Date(o.createdAt).toLocaleString()}</span> },
    { key: 'branch', header: 'Branch', render: (o) => <span className="text-xs">{(o as unknown as { branch?: { name: string } }).branch?.name ?? o.branchId}</span> },
    { key: 'cashier', header: 'Cashier', render: (o) => <span className="text-xs text-gray-500">{(o as unknown as { cashier?: { name: string } }).cashier?.name ?? ''}</span> },
    { key: 'total', header: 'Total', render: (o) => <span className="font-medium">GHS {(parseFloat(o.grandTotal) / 100).toFixed(2)}</span> },
    { key: 'status', header: 'Status', render: (o) => <Badge label={o.status} variant={STATUS_VARIANT[o.status]} /> },
  ];

  const handleRefund = () => {
    if (!refundId) return;
    refundOrder(undefined, {
      onSuccess: () => { toast('Order refunded', 'success'); setRefundId(null); setSelectedId(null); },
      onError: (err: unknown) => {
        toast(getErrorMessage(err, 'Refund failed'), 'error');
      },
    });
  };

  const detail = orderDetail;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Orders</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as OrderStatus | ''); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">All statuses</option>
          {(['PENDING', 'COMPLETED', 'CANCELLED', 'REFUNDED'] as OrderStatus[]).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {user?.role !== 'CASHIER' && branches && branches.length > 1 && (
          <select
            value={branchFilter}
            onChange={(e) => { setBranchFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}

        <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
        <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />

        {(statusFilter || branchFilter || startDate || endDate) && (
          <button onClick={() => { setStatusFilter(''); setBranchFilter(''); setStartDate(''); setEndDate(''); setPage(1); }}
            className="text-xs text-red-500 hover:underline">Clear filters</button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        keyExtractor={(o) => o.id}
        pagination={data?.meta}
        onPageChange={setPage}
        onRowClick={(o) => setSelectedId(o.id)}
        emptyMessage="No orders found"
        emptyDescription="Orders will appear here once customers start purchasing"
      />

      {/* Order detail drawer */}
      <Drawer
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        title={detail ? `Order ${detail.orderNumber}` : 'Order detail'}
        footer={
          canRefund && detail?.status === 'COMPLETED' ? (
            <button
              onClick={() => setRefundId(detail.id)}
              className="w-full py-2.5 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-xl text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              Refund this order
            </button>
          ) : undefined
        }
      >
        {detailLoading ? (
          <div className="space-y-3">
            {[1,2,3].map(n => <div key={n} className="h-10 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />)}
          </div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-gray-400">Status</p><Badge label={detail.status} variant={STATUS_VARIANT[detail.status]} /></div>
              <div><p className="text-xs text-gray-400">Date</p><p>{new Date(detail.createdAt).toLocaleString()}</p></div>
              <div><p className="text-xs text-gray-400">Branch</p><p>{(detail as unknown as { branch?: { name: string } }).branch?.name ?? detail.branchId}</p></div>
              <div><p className="text-xs text-gray-400">Cashier</p><p>{(detail as unknown as { cashier?: { name: string } }).cashier?.name ?? detail.cashierId}</p></div>
            </div>

            {detail.items && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Items</h3>
                <div className="space-y-2">
                  {detail.items.map((item) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{item.productName} × {item.quantity}</span>
                      <span className="font-medium">{(parseFloat(item.lineTotal) / 100).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1 text-sm border-t border-gray-100 dark:border-gray-800 pt-4">
              <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>{(parseFloat(detail.subtotal) / 100).toFixed(2)}</span></div>
              {parseFloat(detail.taxTotal) > 0 && <div className="flex justify-between text-gray-500"><span>Tax</span><span>{(parseFloat(detail.taxTotal) / 100).toFixed(2)}</span></div>}
              {parseFloat(detail.discountTotal) > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>−{(parseFloat(detail.discountTotal) / 100).toFixed(2)}</span></div>}
              <div className="flex justify-between font-bold text-gray-900 dark:text-gray-100 pt-1 border-t border-gray-100 dark:border-gray-800"><span>Total</span><span>{(parseFloat(detail.grandTotal) / 100).toFixed(2)}</span></div>
            </div>

            {detail.payments && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Payments</h3>
                {detail.payments.map((p) => (
                  <div key={p.id} className="flex justify-between text-sm">
                    <span>{p.method.replace('_', ' ')}</span>
                    <div className="flex items-center gap-2">
                      <span>{(parseFloat(p.amount) / 100).toFixed(2)}</span>
                      <Badge label={p.status} variant={p.status === 'SUCCESS' ? 'success' : p.status === 'FAILED' ? 'error' : 'warning'} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={!!refundId}
        onClose={() => setRefundId(null)}
        title="Refund order"
        description="This will refund the full order, restock all items, and create a refund payment record. This cannot be undone."
        confirmLabel="Confirm refund"
        destructive
        isLoading={refunding}
        onConfirm={handleRefund}
      />
    </div>
  );
}
