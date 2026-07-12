'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser } from '@/hooks/api/useUsers';
import { useBranches } from '@/hooks/api/useBranches';
import { useUiStore } from '@/store/uiStore';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';
import Drawer from '@/components/ui/Drawer';
import Modal from '@/components/ui/Modal';
import type { User, Role } from '@/types';

const ROLE_ORDER: Record<Role, number> = {
  SUPER_ADMIN: 4, STORE_ADMIN: 3, BRANCH_MANAGER: 2, CASHIER: 1,
};

const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin', STORE_ADMIN: 'Store Admin', BRANCH_MANAGER: 'Branch Manager', CASHIER: 'Cashier',
};

const ROLE_BADGE: Record<Role, 'error' | 'warning' | 'info' | 'neutral'> = {
  SUPER_ADMIN: 'error', STORE_ADMIN: 'warning', BRANCH_MANAGER: 'info', CASHIER: 'neutral',
};

interface FormState {
  name: string; email: string; password: string;
  role: Role; branchId: string; isActive: boolean;
}

const EMPTY: FormState = { name: '', email: '', password: '', role: 'CASHIER', branchId: '', isActive: true };

export default function UsersPage() {
  const user = useAuthStore((s) => s.user);
  const toast = useUiStore((s) => s.toast);
  const { data: branches } = useBranches();

  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useUsers({ page, limit: 20 });
  const { mutateAsync: createUser, isPending: isCreating } = useCreateUser();
  const { mutateAsync: updateUser, isPending: isUpdating } = useUpdateUser(editUser?.id ?? '');
  const { mutate: deleteUser, isPending: isDeleting } = useDeleteUser(deleteId ?? '');

  const isEditing = !!editUser;
  const isPending = isCreating || isUpdating;

  const myRoleLevel = ROLE_ORDER[user?.role ?? 'CASHIER'];
  const assignableRoles = (Object.keys(ROLE_ORDER) as Role[]).filter(
    (r) => ROLE_ORDER[r] < myRoleLevel,
  );

  const openCreate = () => { setEditUser(null); setForm({ ...EMPTY, role: assignableRoles[0] ?? 'CASHIER', branchId: user?.branchId ?? '' }); setDrawerOpen(true); };
  const openEdit = (u: User) => { setEditUser(u); setForm({ name: u.name, email: u.email, password: '', role: u.role, branchId: u.branchId ?? '', isActive: u.isActive }); setDrawerOpen(true); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: form.name,
        email: form.email,
        role: form.role,
        branchId: form.branchId || undefined,
        isActive: form.isActive,
        ...(form.password && { password: form.password }),
      };
      if (isEditing) {
        await updateUser(payload);
      } else {
        await createUser({ ...payload, password: form.password });
      }
      toast(isEditing ? 'User updated' : 'User created', 'success');
      setDrawerOpen(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast(e.response?.data?.message ?? 'Failed to save user', 'error');
    }
  };

  const columns: Column<User>[] = [
    {
      key: 'name', header: 'User',
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center text-sm font-semibold text-primary-700 dark:text-primary-300 shrink-0">
            {u.name[0]?.toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-sm">{u.name}</p>
            <p className="text-xs text-gray-400">{u.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (u) => <Badge label={ROLE_LABELS[u.role]} variant={ROLE_BADGE[u.role]} /> },
    { key: 'branch', header: 'Branch', render: (u) => <span className="text-xs text-gray-500">{u.branchId ? (branches?.find(b => b.id === u.branchId)?.name ?? u.branchId) : '—'}</span> },
    { key: 'status', header: 'Status', render: (u) => <Badge label={u.isActive ? 'Active' : 'Inactive'} variant={u.isActive ? 'success' : 'neutral'} /> },
    {
      key: 'actions', header: '', className: 'text-right w-24',
      render: (u) => {
        const editable = ROLE_ORDER[u.role] < myRoleLevel;
        return (
          <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            {editable && <button onClick={() => openEdit(u)} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Edit</button>}
            {editable && <button onClick={() => setDeleteId(u.id)} className="text-xs text-red-500 hover:underline">Delete</button>}
          </div>
        );
      },
    },
  ];

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Users</h1>
        {assignableRoles.length > 0 && (
          <button onClick={openCreate} className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium">
            + New user
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        keyExtractor={(u) => u.id}
        pagination={data?.meta}
        onPageChange={setPage}
        emptyMessage="No users yet"
        emptyDescription="Add team members to your store"
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={isEditing ? 'Edit user' : 'New user'}
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => setDrawerOpen(false)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
            <button form="user-form" type="submit" disabled={isPending} className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium disabled:opacity-50">
              {isPending ? 'Saving…' : isEditing ? 'Update' : 'Create'}
            </button>
          </div>
        }
      >
        <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Full name <span className="text-red-500">*</span></label>
            <input required type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Jane Doe" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Email <span className="text-red-500">*</span></label>
            <input required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="jane@example.com" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Password {isEditing && <span className="text-gray-400">(leave blank to keep current)</span>} {!isEditing && <span className="text-red-500">*</span>}</label>
            <input type="password" required={!isEditing} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder={isEditing ? '••••••••' : 'Min 8 characters'} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Role <span className="text-red-500">*</span></label>
            <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))} className={inputClass}>
              {assignableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          {(form.role === 'BRANCH_MANAGER' || form.role === 'CASHIER') && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Branch <span className="text-red-500">*</span></label>
              <select value={form.branchId} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))} required className={inputClass}>
                <option value="">Select branch…</option>
                {branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
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
        title="Delete user"
        description="This will deactivate the user account. They will no longer be able to log in."
        confirmLabel="Delete"
        destructive
        isLoading={isDeleting}
        onConfirm={() =>
          deleteUser(undefined, {
            onSuccess: () => { setDeleteId(null); toast('User deleted', 'success'); },
            onError: () => toast('Failed to delete user', 'error'),
          })
        }
      />
    </div>
  );
}
