'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import {
  useInventory,
  useAdjustStock,
  useTransferStock,
  useStockMovements,
  useAdjustmentRequests,
  useApproveAdjustmentRequest,
  useRejectAdjustmentRequest,
  type StockMovement,
  type AdjustmentReason,
  type AdjustmentRequest,
  type AdjustmentRequestStatus,
} from '@/hooks/api/useInventory';
import { useBranches } from '@/hooks/api/useBranches';
import { useUiStore } from '@/store/uiStore';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';
import Drawer from '@/components/ui/Drawer';
import type { InventoryItem } from '@/types';

type Tab = 'stock' | 'movements' | 'approvals';

const ADJUSTMENT_REASONS: { value: AdjustmentReason; label: string }[] = [
  { value: 'RECOUNT', label: 'Recount / correction' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'THEFT_SUSPECTED', label: 'Suspected theft/loss' },
  { value: 'OTHER', label: 'Other' },
];

interface AdjustForm { quantity: string; reason: AdjustmentReason; note: string }
interface TransferForm { toBranchId: string; quantity: string; note: string }
interface RejectModalState { open: boolean; requestId: string; note: string }

export default function InventoryPage() {
  const user = useAuthStore((s) => s.user);
  const toast = useUiStore((s) => s.toast);
  const { data: branches } = useBranches();

  const [branchId, setBranchId] = useState(user?.branchId ?? '');
  const [tab, setTab] = useState<Tab>('stock');

  // STORE_ADMIN/SUPER_ADMIN have no branchId of their own — without this,
  // branchId stays '' forever (the inventory/movements queries are disabled
  // until it's set) and the branch picker below only rendered when there
  // were 2+ branches, so a single-branch store had no way to populate it at all.
  useEffect(() => {
    if (!branchId && branches && branches.length > 0) {
      setBranchId(branches[0].id);
    }
  }, [branchId, branches]);

  const [page, setPage] = useState(1);
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [transferItem, setTransferItem] = useState<InventoryItem | null>(null);
  const [adjustForm, setAdjustForm] = useState<AdjustForm>({ quantity: '', reason: 'RECOUNT', note: '' });
  const [transferForm, setTransferForm] = useState<TransferForm>({ toBranchId: '', quantity: '', note: '' });
  const [approvalStatus, setApprovalStatus] = useState<AdjustmentRequestStatus | ''>('PENDING');
  const [reject, setReject] = useState<RejectModalState>({ open: false, requestId: '', note: '' });

  const canReview = user?.role === 'STORE_ADMIN' || user?.role === 'SUPER_ADMIN';

  const { data: inventoryData, isLoading } = useInventory({ branchId, page, limit: 25 });
  const { data: movementsData, isLoading: movementsLoading } = useStockMovements({ branchId, page, limit: 25 });
  const { data: approvalsData, isLoading: approvalsLoading } = useAdjustmentRequests({
    status: approvalStatus || undefined,
    page,
    limit: 25,
    enabled: tab === 'approvals',
  });
  const { mutate: adjustStock, isPending: adjusting } = useAdjustStock();
  const { mutate: transferStock, isPending: transferring } = useTransferStock();
  const { mutateAsync: approveRequest, isPending: approving } = useApproveAdjustmentRequest();
  const { mutateAsync: rejectRequest, isPending: rejecting } = useRejectAdjustmentRequest();

  const stockColumns: Column<InventoryItem>[] = [
    {
      key: 'product',
      header: 'Product',
      render: (item) => (
        <div>
          <p className="font-medium">{item.product?.name ?? item.productId}</p>
          <p className="text-xs text-gray-400">{item.product?.sku}</p>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Qty',
      render: (item) => (
        <span className={`font-mono font-semibold ${item.quantity <= item.lowStockThreshold ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-800 dark:text-gray-200'}`}>
          {item.quantity}
        </span>
      ),
    },
    {
      key: 'threshold',
      header: 'Threshold',
      render: (item) => <span className="text-gray-500 text-xs">{item.lowStockThreshold}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) =>
        item.quantity <= 0 ? <Badge label="Out of stock" variant="error" />
        : item.quantity <= item.lowStockThreshold ? <Badge label="Low stock" variant="warning" />
        : <Badge label="OK" variant="success" />,
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right w-40',
      render: (item) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setAdjustItem(item); setAdjustForm({ quantity: '', reason: 'RECOUNT', note: '' }); }} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
            Adjust
          </button>
          {branches && branches.length > 1 && (
            <button onClick={() => { setTransferItem(item); setTransferForm({ toBranchId: '', quantity: '', note: '' }); }} className="text-xs text-gray-500 hover:underline">
              Transfer
            </button>
          )}
        </div>
      ),
    },
  ];

  const handleAdjust = () => {
    if (!adjustItem) return;
    const qty = parseInt(adjustForm.quantity);
    if (isNaN(qty) || qty === 0 || !adjustForm.note.trim()) {
      toast('Enter a non-zero quantity and note', 'warning'); return;
    }
    adjustStock(
      { branchId, productId: adjustItem.productId, quantity: qty, reason: adjustForm.reason, note: adjustForm.note },
      {
        onSuccess: (result) => {
          toast(
            result?.pending
              ? 'Adjustment exceeds your approval limit — sent to your store admin for review'
              : 'Stock adjusted',
            result?.pending ? 'warning' : 'success',
          );
          setAdjustItem(null);
        },
        onError: (err: unknown) => {
          const e = err as { response?: { data?: { message?: string } } };
          toast(e.response?.data?.message ?? 'Adjustment failed', 'error');
        },
      },
    );
  };

  const handleApproveRequest = async (id: string) => {
    try {
      await approveRequest({ id });
      toast('Adjustment approved and applied', 'success');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast(e.response?.data?.message ?? 'Failed to approve', 'error');
    }
  };

  const handleRejectRequest = async () => {
    if (!reject.note.trim()) { toast('Provide a reason for rejecting', 'warning'); return; }
    try {
      await rejectRequest({ id: reject.requestId, reviewNote: reject.note });
      toast('Adjustment rejected', 'success');
      setReject({ open: false, requestId: '', note: '' });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast(e.response?.data?.message ?? 'Failed to reject', 'error');
    }
  };

  const handleTransfer = () => {
    if (!transferItem) return;
    const qty = parseInt(transferForm.quantity);
    if (!transferForm.toBranchId || isNaN(qty) || qty <= 0) {
      toast('Select destination branch and enter quantity', 'warning'); return;
    }
    transferStock(
      { productId: transferItem.productId, fromBranchId: branchId, toBranchId: transferForm.toBranchId, quantity: qty, note: transferForm.note },
      {
        onSuccess: () => { toast('Stock transferred', 'success'); setTransferItem(null); },
        onError: (err: unknown) => {
          const e = err as { response?: { data?: { message?: string } } };
          toast(e.response?.data?.message ?? 'Transfer failed', 'error');
        },
      },
    );
  };

  const otherBranches = branches?.filter((b) => b.id !== branchId) ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Inventory</h1>
        {!user?.branchId && branches && branches.length > 0 && (
          <select
            value={branchId}
            onChange={(e) => { setBranchId(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-100 dark:border-gray-800">
        {(['stock', 'movements', 'approvals'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
              tab === t
                ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {t === 'stock' ? 'Stock levels' : t === 'movements' ? 'Movements' : 'Approvals'}
          </button>
        ))}
      </div>

      {tab === 'stock' ? (
        <DataTable
          columns={stockColumns}
          data={inventoryData?.items ?? []}
          isLoading={isLoading}
          keyExtractor={(i) => i.productId}
          pagination={inventoryData?.meta}
          onPageChange={setPage}
          emptyMessage="No inventory items"
          emptyDescription="Add products and stock to see them here"
        />
      ) : tab === 'movements' ? (
        <MovementsTable data={movementsData?.items ?? []} isLoading={movementsLoading} pagination={movementsData?.meta} onPageChange={setPage} />
      ) : (
        <div className="space-y-3">
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
            {(['PENDING', 'APPROVED', 'REJECTED', ''] as const).map((s) => (
              <button
                key={s || 'ALL'}
                onClick={() => { setApprovalStatus(s); setPage(1); }}
                className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  approvalStatus === s
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {s ? s.charAt(0) + s.slice(1).toLowerCase() : 'All'}
              </button>
            ))}
          </div>
          <ApprovalsTable
            data={approvalsData?.items ?? []}
            isLoading={approvalsLoading}
            pagination={approvalsData?.meta}
            onPageChange={setPage}
            canReview={canReview}
            reviewing={approving || rejecting}
            onApprove={handleApproveRequest}
            onReject={(id) => setReject({ open: true, requestId: id, note: '' })}
          />
        </div>
      )}

      {/* Adjust drawer */}
      <Drawer open={!!adjustItem} onClose={() => setAdjustItem(null)} title={`Adjust stock — ${adjustItem?.product?.name ?? ''}`}
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => setAdjustItem(null)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
            <button onClick={handleAdjust} disabled={adjusting} className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium disabled:opacity-50">
              {adjusting ? 'Saving…' : 'Save adjustment'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {adjustItem && <p className="text-sm text-gray-500 dark:text-gray-400">Current quantity: <strong className="text-gray-900 dark:text-gray-100">{adjustItem.quantity}</strong></p>}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Adjustment (+ to add, − to remove)</label>
            <input type="number" value={adjustForm.quantity} onChange={(e) => setAdjustForm((f) => ({ ...f, quantity: e.target.value }))}
              placeholder="e.g. 10 or -5" className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Reason <span className="text-red-500">*</span></label>
            <select value={adjustForm.reason} onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value as AdjustmentReason }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
              {ADJUSTMENT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Note <span className="text-red-500">*</span></label>
            <textarea rows={3} value={adjustForm.note} onChange={(e) => setAdjustForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Reason for adjustment…" className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none" />
          </div>
        </div>
      </Drawer>

      {/* Transfer drawer */}
      <Drawer open={!!transferItem} onClose={() => setTransferItem(null)} title={`Transfer stock — ${transferItem?.product?.name ?? ''}`}
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => setTransferItem(null)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
            <button onClick={handleTransfer} disabled={transferring} className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium disabled:opacity-50">
              {transferring ? 'Transferring…' : 'Transfer'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {transferItem && <p className="text-sm text-gray-500 dark:text-gray-400">Available: <strong className="text-gray-900 dark:text-gray-100">{transferItem.quantity}</strong></p>}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Destination branch <span className="text-red-500">*</span></label>
            <select value={transferForm.toBranchId} onChange={(e) => setTransferForm((f) => ({ ...f, toBranchId: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">Select branch…</option>
              {otherBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Quantity <span className="text-red-500">*</span></label>
            <input type="number" min="1" value={transferForm.quantity} onChange={(e) => setTransferForm((f) => ({ ...f, quantity: e.target.value }))}
              placeholder="How many units to transfer" className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Note</label>
            <input type="text" value={transferForm.note} onChange={(e) => setTransferForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Optional reason" className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
        </div>
      </Drawer>

      {/* Reject adjustment request modal */}
      {reject.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Reject adjustment</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">Provide a reason so the requester understands why.</p>
            <textarea rows={3} value={reject.note} onChange={(e) => setReject((r) => ({ ...r, note: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              placeholder="Reason for rejection…" />
            <div className="flex gap-3">
              <button onClick={() => setReject({ open: false, requestId: '', note: '' })}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Cancel
              </button>
              <button disabled={!reject.note.trim() || rejecting} onClick={handleRejectRequest}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-40">
                {rejecting ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Movements sub-table ───────────────────────────────────────────────────────
const MOVEMENT_VARIANT: Record<string, 'success' | 'error' | 'info' | 'neutral'> = {
  PURCHASE: 'success', SALE: 'error', RETURN: 'success',
  ADJUSTMENT: 'info', TRANSFER_IN: 'success', TRANSFER_OUT: 'error',
};

const REASON_LABEL: Record<AdjustmentReason, string> = {
  DAMAGED: 'Damaged',
  EXPIRED: 'Expired',
  RECOUNT: 'Recount',
  THEFT_SUSPECTED: 'Suspected theft',
  OTHER: 'Other',
};

function MovementsTable({ data, isLoading, pagination, onPageChange }: {
  data: StockMovement[];
  isLoading: boolean;
  pagination?: { total: number; page: number; limit: number; totalPages: number };
  onPageChange?: (p: number) => void;
}) {
  const cols: Column<StockMovement>[] = [
    { key: 'type', header: 'Type', render: (m) => <Badge label={m.type.replace('_', ' ')} variant={MOVEMENT_VARIANT[m.type] ?? 'neutral'} /> },
    { key: 'product', header: 'Product', render: (m) => m.inventoryItem?.product?.name ?? '—' },
    { key: 'qty', header: 'Qty', render: (m) => <span className={`font-mono font-semibold ${m.quantity > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span> },
    {
      key: 'reason', header: 'Reason',
      render: (m) => m.reason
        ? <Badge label={REASON_LABEL[m.reason]} variant={m.reason === 'THEFT_SUSPECTED' ? 'error' : 'neutral'} />
        : <span className="text-gray-400 text-xs">—</span>,
    },
    {
      key: 'note', header: 'Note',
      render: (m) => (
        <span className={`text-xs ${m.reason === 'THEFT_SUSPECTED' ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500'}`}>
          {m.note ?? '—'}
        </span>
      ),
    },
    { key: 'user', header: 'By', render: (m) => <span className="text-xs">{m.user?.name ?? '—'}</span> },
    { key: 'date', header: 'Date', render: (m) => <span className="text-xs text-gray-400">{new Date(m.createdAt).toLocaleString()}</span> },
  ];
  return (
    <DataTable
      columns={cols}
      data={data}
      isLoading={isLoading}
      keyExtractor={(m) => m.id}
      pagination={pagination}
      onPageChange={onPageChange}
      emptyMessage="No stock movements yet"
      rowClassName={(m) => (m.reason === 'THEFT_SUSPECTED' ? 'bg-red-50 dark:bg-red-900/10' : '')}
    />
  );
}

// ── Approvals sub-table ───────────────────────────────────────────────────────

const APPROVAL_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error'> = {
  PENDING: 'warning', APPROVED: 'success', REJECTED: 'error',
};

function ApprovalsTable({ data, isLoading, pagination, onPageChange, canReview, reviewing, onApprove, onReject }: {
  data: AdjustmentRequest[];
  isLoading: boolean;
  pagination?: { total: number; page: number; limit: number; totalPages: number };
  onPageChange?: (p: number) => void;
  canReview: boolean;
  reviewing: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const cols: Column<AdjustmentRequest>[] = [
    {
      key: 'product', header: 'Product',
      render: (r) => (
        <div>
          <p className="font-medium">{r.product.name}</p>
          <p className="text-xs text-gray-400">{r.product.sku}</p>
        </div>
      ),
    },
    { key: 'branch', header: 'Branch', render: (r) => <span className="text-xs">{r.branch.name}</span> },
    { key: 'qty', header: 'Qty', render: (r) => <span className={`font-mono font-semibold ${r.quantity > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{r.quantity > 0 ? `+${r.quantity}` : r.quantity}</span> },
    {
      key: 'reason', header: 'Reason',
      render: (r) => <Badge label={REASON_LABEL[r.reason]} variant={r.reason === 'THEFT_SUSPECTED' ? 'error' : 'neutral'} />,
    },
    { key: 'note', header: 'Note', render: (r) => <span className="text-gray-500 text-xs">{r.note}</span> },
    { key: 'requestedBy', header: 'Requested by', render: (r) => <span className="text-xs">{r.requestedBy.name}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge label={r.status} variant={APPROVAL_STATUS_VARIANT[r.status]} /> },
    { key: 'date', header: 'Date', render: (r) => <span className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleString()}</span> },
    ...(canReview
      ? [{
          key: 'actions', header: '', className: 'text-right',
          render: (r: AdjustmentRequest) => r.status === 'PENDING' ? (
            <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
              <button disabled={reviewing} onClick={() => onApprove(r.id)}
                className="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors font-medium disabled:opacity-50">
                Approve
              </button>
              <button disabled={reviewing} onClick={() => onReject(r.id)}
                className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors font-medium disabled:opacity-50">
                Reject
              </button>
            </div>
          ) : (
            <span className="text-xs text-gray-400">{r.reviewedBy?.name ?? '—'}</span>
          ),
        } satisfies Column<AdjustmentRequest>]
      : []),
  ];
  return (
    <DataTable
      columns={cols}
      data={data}
      isLoading={isLoading}
      keyExtractor={(r) => r.id}
      pagination={pagination}
      onPageChange={onPageChange}
      emptyMessage="No adjustment requests"
      emptyDescription="Large stock adjustments by branch managers will show up here for review"
      rowClassName={(r) => (r.reason === 'THEFT_SUSPECTED' ? 'bg-red-50 dark:bg-red-900/10' : '')}
    />
  );
}
