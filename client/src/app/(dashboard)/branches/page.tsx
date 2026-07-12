'use client';

import { useState } from 'react';
import { useBranches, useCreateBranch, useUpdateBranch, useDeleteBranch } from '@/hooks/api/useBranches';
import { useUiStore } from '@/store/uiStore';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';
import Drawer from '@/components/ui/Drawer';
import Modal from '@/components/ui/Modal';
import type { Branch } from '@/types';

interface FormState { name: string; address: string; phone: string; isActive: boolean }
const EMPTY: FormState = { name: '', address: '', phone: '', isActive: true };

function toForm(b: Branch): FormState {
  return { name: b.name, address: b.address ?? '', phone: b.phone ?? '', isActive: b.isActive };
}

export default function BranchesPage() {
  const toast = useUiStore((s) => s.toast);
  const { data: branches, isLoading } = useBranches();
  const { mutateAsync: createBranch, isPending: isCreating } = useCreateBranch();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Hooks called at top level with current IDs — safe, they re-bind on state change
  const { mutateAsync: updateBranch, isPending: isUpdating } = useUpdateBranch(editBranch?.id ?? '');
  const { mutate: doDelete, isPending: deletePending } = useDeleteBranch(deleteId ?? '');

  const isEditing = !!editBranch;
  const isPending = isCreating || isUpdating;

  const openCreate = () => { setEditBranch(null); setForm(EMPTY); setDrawerOpen(true); };
  const openEdit = (b: Branch) => { setEditBranch(b); setForm(toForm(b)); setDrawerOpen(true); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isEditing) {
        await updateBranch(form);
      } else {
        await createBranch(form);
      }
      toast(isEditing ? 'Branch updated' : 'Branch created', 'success');
      setDrawerOpen(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast(e.response?.data?.message ?? 'Failed to save branch', 'error');
    }
  };

  const columns: Column<Branch>[] = [
    { key: 'name', header: 'Name', render: (b) => <span className="font-medium">{b.name}</span> },
    { key: 'address', header: 'Address', render: (b) => <span className="text-gray-500 text-xs">{b.address ?? '—'}</span> },
    { key: 'phone', header: 'Phone', render: (b) => <span className="text-xs">{b.phone ?? '—'}</span> },
    { key: 'status', header: 'Status', render: (b) => <Badge label={b.isActive ? 'Active' : 'Inactive'} variant={b.isActive ? 'success' : 'neutral'} /> },
    {
      key: 'actions', header: '', className: 'text-right w-24',
      render: (b) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => openEdit(b)} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Edit</button>
          <button onClick={() => setDeleteId(b.id)} className="text-xs text-red-500 hover:underline">Delete</button>
        </div>
      ),
    },
  ];

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Branches</h1>
        <button onClick={openCreate} className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium">
          + New branch
        </button>
      </div>

      <DataTable
        columns={columns}
        data={branches ?? []}
        isLoading={isLoading}
        keyExtractor={(b) => b.id}
        emptyMessage="No branches yet"
        emptyDescription="Create your first branch to start taking orders"
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={isEditing ? 'Edit branch' : 'New branch'}
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => setDrawerOpen(false)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
            <button form="branch-form" type="submit" disabled={isPending} className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium disabled:opacity-50">
              {isPending ? 'Saving…' : isEditing ? 'Update' : 'Create'}
            </button>
          </div>
        }
      >
        <form id="branch-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Branch name <span className="text-red-500">*</span></label>
            <input required type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Main Street" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Address</label>
            <input type="text" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Street address" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Phone</label>
            <input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+233 XX XXX XXXX" className={inputClass} />
          </div>
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="sr-only peer" />
              <div className="w-9 h-5 bg-gray-200 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600" />
            </label>
            <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
          </div>
        </form>
      </Drawer>

      <Modal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete branch"
        description="This will deactivate the branch and prevent further orders. Existing data is retained."
        confirmLabel="Delete"
        destructive
        isLoading={deletePending}
        onConfirm={() =>
          doDelete(undefined, {
            onSuccess: () => { setDeleteId(null); toast('Branch deleted', 'success'); },
            onError: () => toast('Failed to delete branch', 'error'),
          })
        }
      />
    </div>
  );
}
