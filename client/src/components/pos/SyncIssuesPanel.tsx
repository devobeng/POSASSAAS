'use client';

import { useState, useCallback } from 'react';
import { X, CheckCircle2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type FailedOrder } from '@/lib/db';
import { useConnectivityStore } from '@/store/connectivityStore';
import { useUiStore } from '@/store/uiStore';
import api from '@/lib/axios';

interface Props {
  onClose: () => void;
}

interface SyncResult {
  clientOrderId: string;
  status: 'created' | 'duplicate' | 'failed';
  error?: string;
}

export default function SyncIssuesPanel({ onClose }: Props) {
  const failedOrders = useLiveQuery(() => db.failedOrders.orderBy('failedAt').reverse().toArray(), []);
  const status = useConnectivityStore((s) => s.status);
  const setFailedCount = useConnectivityStore((s) => s.setFailedCount);
  const toast = useUiStore((s) => s.toast);
  const [retrying, setRetrying] = useState<Set<number>>(new Set());

  const handleRetry = useCallback(async (order: FailedOrder) => {
    if (!order._localId || status === 'offline') {
      toast('Cannot retry while offline', 'error');
      return;
    }
    setRetrying((prev) => new Set(prev).add(order._localId!));
    try {
      const res = await api.post<{ data: { results: SyncResult[] } }>('/sync/orders', {
        orders: [order.payload],
      });
      const result = res.data.data.results[0];
      if (result?.status === 'created' || result?.status === 'duplicate') {
        await db.failedOrders.delete(order._localId);
        const remaining = await db.failedOrders.count();
        setFailedCount(remaining);
        toast('Order synced successfully', 'success');
      } else {
        toast(result?.error ?? 'Sync failed — order moved back to queue', 'error');
        // Move back to pending queue for the engine to pick up
        await db.pendingOrders.add({
          clientOrderId: order.clientOrderId,
          payload: order.payload,
          retryCount: 0,
          nextRetryAt: 0,
          createdAt: order.payload.createdAtClient,
        });
        await db.failedOrders.delete(order._localId);
        const remaining = await db.failedOrders.count();
        setFailedCount(remaining);
      }
    } catch {
      toast('Retry failed — check connection', 'error');
    } finally {
      setRetrying((prev) => { const s = new Set(prev); s.delete(order._localId!); return s; });
    }
  }, [status, setFailedCount, toast]);

  const handleExport = useCallback((order: FailedOrder) => {
    const blob = new Blob([JSON.stringify(order.payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `order-${order.payload.offlineReference}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleExportAll = useCallback(async () => {
    const all = await db.failedOrders.toArray();
    const blob = new Blob([JSON.stringify(all.map((o) => o.payload), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `failed-orders-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleDismiss = useCallback(async (order: FailedOrder) => {
    if (!order._localId) return;
    await db.failedOrders.delete(order._localId);
    const remaining = await db.failedOrders.count();
    setFailedCount(remaining);
  }, [setFailedCount]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

  const fmtMoney = (pesewas: number) => (pesewas / 100).toFixed(2);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full sm:max-w-lg bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Sync Issues</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {failedOrders?.length ?? 0} orders failed to sync after 5 retries
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(failedOrders?.length ?? 0) > 0 && (
              <button
                onClick={handleExportAll}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Export all
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {!failedOrders || failedOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CheckCircle2 className="w-10 h-10 mb-3 text-green-500" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No failed orders</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {failedOrders.map((order) => {
                const isRetrying = order._localId !== undefined && retrying.has(order._localId);
                const grandTotal = order.payload.payments.reduce((s, p) => s + p.amount, 0);
                return (
                  <div key={order._localId} className="px-5 py-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 font-mono">
                          {order.payload.offlineReference}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {fmt(order.payload.createdAtClient)} · {fmtMoney(grandTotal)} ·{' '}
                          {order.payload.items.length} item{order.payload.items.length !== 1 ? 's' : ''}
                        </p>
                        <p className="text-xs text-red-500 dark:text-red-400 mt-1 truncate">
                          {order.error}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleExport(order)}
                          className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          Export
                        </button>
                        <button
                          onClick={() => handleRetry(order)}
                          disabled={isRetrying || status === 'offline'}
                          className="text-xs px-2 py-1 rounded bg-primary-600 hover:bg-primary-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isRetrying ? '…' : 'Retry'}
                        </button>
                        <button
                          onClick={() => handleDismiss(order)}
                          title="Dismiss (order will not be synced)"
                          className="text-xs px-2 py-1 rounded border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Payment methods */}
                    <div className="flex gap-1.5 flex-wrap">
                      {order.payload.payments.map((p, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                        >
                          {p.method.replace('_', ' ')} {fmtMoney(p.amount)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
