'use client';

import { useState, useRef } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Drawer from '@/components/ui/Drawer';
import Badge from '@/components/ui/Badge';
import {
  useExpenses,
  useExpenseCategories,
  useCreateExpense,
  useUpdateExpense,
  useDeleteExpense,
  useApproveExpense,
  useRejectExpense,
  useUploadExpenseReceipt,
} from '@/hooks/api/useExpenses';
import { useBranches } from '@/hooks/api/useBranches';
import type { Expense, ExpenseStatus } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<ExpenseStatus, { label: string; variant: 'success' | 'warning' | 'error' | 'neutral' }> = {
  APPROVED: { label: 'Approved', variant: 'success' },
  PENDING:  { label: 'Pending',  variant: 'warning' },
  REJECTED: { label: 'Rejected', variant: 'error' },
};

function formatAmount(n: number, currency = 'GHS') {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency', currency, minimumFractionDigits: 2,
  }).format(n / 100);
}

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Expense Drawer (create / edit) ──────────────────────────────────────────

interface DrawerForm {
  categoryId: string;
  branchId: string;
  amount: string;
  description: string;
  expenseDate: string;
  isRecurring: boolean;
  recurringInterval: 'WEEKLY' | 'MONTHLY';
}

const emptyForm = (): DrawerForm => ({
  categoryId: '',
  branchId: '',
  amount: '',
  description: '',
  expenseDate: new Date().toISOString().split('T')[0],
  isRecurring: false,
  recurringInterval: 'MONTHLY',
});

function fromExpense(e: Expense): DrawerForm {
  return {
    categoryId:        e.categoryId,
    branchId:          e.branchId ?? '',
    amount:            String(e.amount / 100),
    description:       e.description,
    expenseDate:       e.expenseDate.split('T')[0],
    isRecurring:       e.isRecurring,
    recurringInterval: e.recurringInterval ?? 'MONTHLY',
  };
}

interface RejectModalState { open: boolean; expenseId: string; note: string }

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const user  = useAuthStore((s) => s.user);
  const toast = useUiStore((s) => s.toast);

  const isAdmin   = user?.role === 'STORE_ADMIN' || user?.role === 'SUPER_ADMIN';
  const isManager = user?.role === 'BRANCH_MANAGER';

  // ── Filters ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab]     = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [page, setPage]               = useState(1);
  const [filterCategory, setFilterCat] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [startDate, setStartDate]     = useState('');
  const [endDate, setEndDate]         = useState('');

  const status = activeTab === 'ALL' ? undefined : activeTab;

  const { data: expData, isLoading } = useExpenses({
    page, limit: 20,
    status,
    categoryId: filterCategory || undefined,
    branchId:   filterBranch   || undefined,
    startDate:  startDate      || undefined,
    endDate:    endDate        || undefined,
  });

  const { data: categories = [] } = useExpenseCategories();
  const { data: branches = [] }   = useBranches();

  // ── Mutations ──────────────────────────────────────────────────────────────
  const { mutateAsync: createExpense, isPending: creating }  = useCreateExpense();
  const { mutateAsync: updateExpense, isPending: updating }  = useUpdateExpense();
  const { mutateAsync: deleteExpense }                       = useDeleteExpense();
  const { mutateAsync: approveExpense }                      = useApproveExpense();
  const { mutateAsync: rejectExpense }                       = useRejectExpense();
  const { mutateAsync: uploadReceipt }                       = useUploadExpenseReceipt();

  // ── Drawer state ───────────────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [editing, setEditing]         = useState<Expense | null>(null);
  const [form, setForm]               = useState<DrawerForm>(emptyForm());
  const receiptRef                    = useRef<HTMLInputElement>(null);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setDrawerOpen(true); };
  const openEdit   = (e: Expense) => {
    if (e.status !== 'PENDING') { toast('Only PENDING expenses can be edited', 'error'); return; }
    setEditing(e); setForm(fromExpense(e)); setDrawerOpen(true);
  };

  const handleSubmit = async (evt: React.FormEvent) => {
    evt.preventDefault();
    const amountInt = Math.round(parseFloat(form.amount) * 100);
    if (isNaN(amountInt) || amountInt <= 0) { toast('Enter a valid amount', 'error'); return; }
    try {
      const payload = {
        categoryId:  form.categoryId,
        branchId:    form.branchId || undefined,
        amount:      amountInt,
        description: form.description,
        expenseDate: form.expenseDate,
        isRecurring: form.isRecurring,
        recurringInterval: form.isRecurring ? form.recurringInterval : undefined,
      };
      if (editing) {
        await updateExpense({ id: editing.id, ...payload });
        toast('Expense updated', 'success');
      } else {
        await createExpense(payload);
        toast('Expense recorded', 'success');
      }
      setDrawerOpen(false);
    } catch (err: unknown) {
      toast((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save expense', 'error');
    }
  };

  // ── Reject modal ───────────────────────────────────────────────────────────
  const [reject, setReject] = useState<RejectModalState>({ open: false, expenseId: '', note: '' });

  const handleApprove = async (id: string) => {
    try { await approveExpense(id); toast('Expense approved', 'success'); }
    catch (err: unknown) { toast((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed', 'error'); }
  };

  const handleReject = async () => {
    try {
      await rejectExpense({ id: reject.expenseId, note: reject.note });
      toast('Expense rejected', 'success');
      setReject({ open: false, expenseId: '', note: '' });
    } catch (err: unknown) {
      toast((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this expense?')) return;
    try { await deleteExpense(id); toast('Deleted', 'success'); }
    catch { toast('Cannot delete', 'error'); }
  };

  // ── Receipt upload ─────────────────────────────────────────────────────────
  const handleReceiptFile = async (expenseId: string, file: File) => {
    try { await uploadReceipt({ id: expenseId, file }); toast('Receipt uploaded', 'success'); }
    catch { toast('Upload failed', 'error'); }
  };

  // ── Columns ────────────────────────────────────────────────────────────────
  const inputCls = 'px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

  const columns: Column<Expense>[] = [
    {
      key: 'date', header: 'Date',
      render: (e) => (
        <span className="text-sm">{fmt(e.expenseDate)}</span>
      ),
    },
    {
      key: 'category', header: 'Category',
      render: (e) => (
        <span className="text-sm font-medium">{e.category.name}</span>
      ),
    },
    {
      key: 'desc', header: 'Description',
      render: (e) => (
        <span className="text-sm text-gray-600 dark:text-gray-400 truncate max-w-xs block">{e.description}</span>
      ),
    },
    {
      key: 'branch', header: 'Branch',
      render: (e) => (
        <span className="text-sm">{e.branch ? e.branch.name : '—'}</span>
      ),
    },
    {
      key: 'amount', header: 'Amount',
      render: (e) => (
        <span className="text-sm font-semibold tabular-nums">{formatAmount(e.amount)}</span>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: (e) => {
        const s = STATUS_BADGE[e.status];
        return <Badge variant={s.variant} label={s.label} />;
      },
    },
    { key: 'actions',  header: '', render: (e) => (
      <div className="flex items-center gap-1 justify-end">
        {isAdmin && e.status === 'PENDING' && (
          <>
            <button onClick={() => handleApprove(e.id)}
              className="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors font-medium">
              Approve
            </button>
            <button onClick={() => setReject({ open: true, expenseId: e.id, note: '' })}
              className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors font-medium">
              Reject
            </button>
          </>
        )}
        {(e.status === 'PENDING') && (isAdmin || isManager) && (
          <button onClick={() => openEdit(e)}
            className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
            Edit
          </button>
        )}
        {e.receiptImageUrl ? (
          <a href={e.receiptImageUrl} target="_blank" rel="noreferrer"
            className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
            Receipt
          </a>
        ) : e.status === 'PENDING' && (
          <button onClick={() => receiptRef.current?.setAttribute('data-id', e.id) ?? receiptRef.current?.click()}
            className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 transition-colors">
            + Receipt
          </button>
        )}
        {(isAdmin || (isManager && e.status === 'PENDING')) && (
          <button onClick={() => handleDelete(e.id)}
            className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            Del
          </button>
        )}
      </div>
    )},
  ];

  const items = expData?.items ?? [];
  const totalPages = expData ? Math.ceil(expData.total / expData.limit) : 1;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Expenses</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Track and manage store expenses</p>
        </div>
        {(isAdmin || isManager) && (
          <button onClick={openCreate}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-colors">
            + Record expense
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
        {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((tab) => (
          <button key={tab} onClick={() => { setActiveTab(tab); setPage(1); }}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              activeTab === tab
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}>
            {tab === 'ALL' ? 'All' : tab.charAt(0) + tab.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap gap-3">
        <select value={filterCategory} onChange={(e) => { setFilterCat(e.target.value); setPage(1); }} className={inputCls}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {isAdmin && (
          <select value={filterBranch} onChange={(e) => { setFilterBranch(e.target.value); setPage(1); }} className={inputCls}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }} className={inputCls} placeholder="From" />
        <input type="date" value={endDate}   onChange={(e) => { setEndDate(e.target.value); setPage(1); }}   className={inputCls} placeholder="To" />
        <a href={`/api/v1/expenses?format=csv&status=${status ?? ''}&categoryId=${filterCategory}&startDate=${startDate}&endDate=${endDate}`}
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          Export CSV
        </a>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        keyExtractor={(e) => e.id}
        emptyMessage="No expenses found"
        emptyDescription={activeTab === 'PENDING' ? 'No expenses pending approval' : 'Record your first expense to get started'}
        pagination={{ page, totalPages, total: expData?.total ?? 0, limit: 20 }}
        onPageChange={setPage}
      />

      {/* Hidden receipt file input */}
      <input ref={receiptRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const id   = receiptRef.current?.getAttribute('data-id');
          if (file && id) handleReceiptFile(id, file);
          e.target.value = '';
        }}
      />

      {/* Create / Edit drawer */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}
        title={editing ? 'Edit expense' : 'Record expense'}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setDrawerOpen(false)}
              className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancel
            </button>
            <button form="expense-form" type="submit" disabled={creating || updating}
              className="flex-1 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">
              {creating || updating ? 'Saving…' : editing ? 'Update' : 'Record'}
            </button>
          </div>
        }>
        <form id="expense-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Category *</label>
            <select required value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))} className={`w-full ${inputCls}`}>
              <option value="">Select category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {isAdmin && (
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Branch</label>
              <select value={form.branchId} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))} className={`w-full ${inputCls}`}>
                <option value="">Store-wide (no branch)</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Amount *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">₦</span>
              <input type="number" required min="0.01" step="0.01" placeholder="0.00"
                value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className={`w-full pl-7 ${inputCls}`} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Date *</label>
            <input type="date" required value={form.expenseDate}
              onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))}
              className={`w-full ${inputCls}`} />
          </div>

          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Description *</label>
            <textarea required rows={3} maxLength={500}
              value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={`w-full resize-none ${inputCls}`} placeholder="What is this expense for?" />
          </div>

          {!editing && (
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <div className={`relative w-10 h-6 rounded-full transition-colors ${form.isRecurring ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                  onClick={() => setForm((f) => ({ ...f, isRecurring: !f.isRecurring }))}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.isRecurring ? 'translate-x-4' : ''}`} />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-300">Recurring expense</span>
              </label>

              {form.isRecurring && (
                <div className="flex gap-3 ml-13">
                  {(['WEEKLY', 'MONTHLY'] as const).map((iv) => (
                    <label key={iv} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" checked={form.recurringInterval === iv}
                        onChange={() => setForm((f) => ({ ...f, recurringInterval: iv }))}
                        className="accent-primary-600" />
                      <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">{iv.toLowerCase()}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </form>
      </Drawer>

      {/* Reject modal */}
      {reject.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Reject expense</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">Provide a reason so the recorder understands what to fix.</p>
            <textarea rows={3} value={reject.note} onChange={(e) => setReject((r) => ({ ...r, note: e.target.value }))}
              className={`w-full resize-none ${inputCls}`} placeholder="Reason for rejection…" />
            <div className="flex gap-3">
              <button onClick={() => setReject({ open: false, expenseId: '', note: '' })}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Cancel
              </button>
              <button disabled={!reject.note.trim()} onClick={handleReject}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-40">
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


