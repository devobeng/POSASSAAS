'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useInventory, useAdjustStock, useTransferStock, useStockMovements } from '@/hooks/api/useInventory';
import { useBranches } from '@/hooks/api/useBranches';
import { useUiStore } from '@/store/uiStore';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';
import Drawer from '@/components/ui/Drawer';
import type { InventoryItem } from '@/types';

type Tab = 'stock' | 'movements';

interface AdjustForm { quantity: string; note: string }
interface TransferForm { toBranchId: string; quantity: string; note: string }

export default function InventoryPage() {
  const user = useAuthStore((s) => s.user);
  const toast = useUiStore((s) => s.toast);
  const { data: branches } = useBranches();

  const [branchId, setBranchId] = useState(user?.branchId ?? '');
  const [tab, setTab] = useState<Tab>('stock');
  const [page, setPage] = useState(1);
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [transferItem, setTransferItem] = useState<InventoryItem | null>(null);
  const [adjustForm, setAdjustForm] = useState<AdjustForm>({ quantity: '', note: '' });
  const [transferForm, setTransferForm] = useState<TransferForm>({ toBranchId: '', quantity: '', note: '' });

  const { data: inventoryData, isLoading } = useInventory({ branchId, page, limit: 25 });
  const { data: movementsData, isLoading: movementsLoading } = useStockMovements({ branchId, page, limit: 25 });
  const { mutate: adjustStock, isPending: adjusting } = useAdjustStock();
  const { mutate: transferStock, isPending: transferring } = useTransferStock();

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
          <button onClick={() => { setAdjustItem(item); setAdjustForm({ quantity: '', note: '' }); }} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
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
    if (isNaN(qty) || !adjustForm.note.trim()) {
      toast('Enter a quantity and note', 'warning'); return;
    }
    adjustStock(
      { branchId, productId: adjustItem.productId, quantity: qty, note: adjustForm.note },
      {
        onSuccess: () => { toast('Stock adjusted', 'success'); setAdjustItem(null); },
        onError: () => toast('Adjustment failed', 'error'),
      },
    );
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
        {branches && branches.length > 1 && (
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
        {(['stock', 'movements'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
              tab === t
                ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {t === 'stock' ? 'Stock levels' : 'Movements'}
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
      ) : (
        <MovementsTable data={(movementsData as { items: MovementRow[]; meta: unknown } | undefined)?.items ?? []} isLoading={movementsLoading} pagination={(movementsData as { meta: { total: number; page: number; limit: number; totalPages: number } } | undefined)?.meta} onPageChange={setPage} />
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
    </div>
  );
}

// ── Movements sub-table ───────────────────────────────────────────────────────
interface MovementRow {
  id: string;
  type: string;
  quantity: number;
  note: string | null;
  createdAt: string;
  inventoryItem?: { product?: { name: string } | null };
  user?: { name: string } | null;
}

const MOVEMENT_VARIANT: Record<string, 'success' | 'error' | 'info' | 'neutral'> = {
  PURCHASE: 'success', SALE: 'error', RETURN: 'success',
  ADJUSTMENT: 'info', TRANSFER_IN: 'success', TRANSFER_OUT: 'error',
};

function MovementsTable({ data, isLoading, pagination, onPageChange }: {
  data: MovementRow[];
  isLoading: boolean;
  pagination?: { total: number; page: number; limit: number; totalPages: number };
  onPageChange?: (p: number) => void;
}) {
  const cols: Column<MovementRow>[] = [
    { key: 'type', header: 'Type', render: (m) => <Badge label={m.type.replace('_', ' ')} variant={MOVEMENT_VARIANT[m.type] ?? 'neutral'} /> },
    { key: 'product', header: 'Product', render: (m) => m.inventoryItem?.product?.name ?? '—' },
    { key: 'qty', header: 'Qty', render: (m) => <span className={`font-mono font-semibold ${m.quantity > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span> },
    { key: 'note', header: 'Note', render: (m) => <span className="text-gray-500 text-xs">{m.note ?? '—'}</span> },
    { key: 'user', header: 'By', render: (m) => <span className="text-xs">{m.user?.name ?? '—'}</span> },
    { key: 'date', header: 'Date', render: (m) => <span className="text-xs text-gray-400">{new Date(m.createdAt).toLocaleString()}</span> },
  ];
  return <DataTable columns={cols} data={data} isLoading={isLoading} keyExtractor={(m) => m.id} pagination={pagination as { total: number; page: number; limit: number; totalPages: number } | undefined} onPageChange={onPageChange} emptyMessage="No stock movements yet" />;
}
