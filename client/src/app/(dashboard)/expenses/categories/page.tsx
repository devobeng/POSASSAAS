'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import {
  useExpenseCategories,
  useCreateExpenseCategory,
  useUpdateExpenseCategory,
  useDeleteExpenseCategory,
} from '@/hooks/api/useExpenses';

export default function ExpenseCategoriesPage() {
  const user  = useAuthStore((s) => s.user);
  const toast = useUiStore((s) => s.toast);

  const isAdmin = user?.role === 'STORE_ADMIN' || user?.role === 'SUPER_ADMIN';

  const { data: categories = [], isLoading } = useExpenseCategories();
  const { mutateAsync: create, isPending: creating } = useCreateExpenseCategory();
  const { mutateAsync: update, isPending: updating } = useUpdateExpenseCategory();
  const { mutateAsync: remove }                      = useDeleteExpenseCategory();

  const [newName,  setNewName]   = useState('');
  const [editId,   setEditId]    = useState<string | null>(null);
  const [editName, setEditName]  = useState('');

  const inputCls = 'px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await create(newName.trim());
      setNewName('');
      toast('Category created', 'success');
    } catch (err: unknown) {
      toast((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed', 'error');
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await update({ id, name: editName.trim() });
      setEditId(null);
      toast('Category updated', 'success');
    } catch (err: unknown) {
      toast((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed', 'error');
    }
  };

  const handleDelete = async (id: string, expenseCount: number) => {
    if (expenseCount > 0) {
      toast(`Cannot delete — ${expenseCount} expense(s) use this category. Reassign them first.`, 'error');
      return;
    }
    if (!confirm('Delete this category?')) return;
    try { await remove(id); toast('Deleted', 'success'); }
    catch (err: unknown) {
      toast((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed', 'error');
    }
  };

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Expense categories</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Manage the categories used to classify expenses across your store.
        </p>
      </div>

      {/* Create form */}
      {isAdmin && (
        <form onSubmit={handleCreate} className="flex gap-3">
          <input
            type="text"
            placeholder="New category name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={100}
            className={`flex-1 ${inputCls}`}
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            {creating ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}

      {/* Category list */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="px-4 py-3 flex items-center gap-3">
                <div className="h-4 w-32 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                <div className="h-4 w-16 bg-gray-100 dark:bg-gray-800 rounded animate-pulse ml-auto" />
              </div>
            ))}
          </div>
        ) : categories.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No categories yet. Add one above.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {categories.map((cat) => (
              <div key={cat.id} className="px-4 py-3 flex items-center gap-3">
                {editId === cat.id ? (
                  <>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleUpdate(cat.id); if (e.key === 'Escape') setEditId(null); }}
                      autoFocus
                      maxLength={100}
                      className={`flex-1 ${inputCls} py-1`}
                    />
                    <button
                      onClick={() => void handleUpdate(cat.id)}
                      disabled={updating}
                      className="text-sm px-3 py-1 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditId(null)}
                      className="text-sm px-3 py-1 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-gray-900 dark:text-gray-100 font-medium">
                      {cat.name}
                      {cat.isDefault && (
                        <span className="ml-2 text-xs text-gray-400 font-normal">(default)</span>
                      )}
                    </span>
                    <span className="text-xs text-gray-400 tabular-nums">
                      {cat._count?.expenses ?? 0} expense{(cat._count?.expenses ?? 0) !== 1 ? 's' : ''}
                    </span>
                    {isAdmin && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => { setEditId(cat.id); setEditName(cat.name); }}
                          className="text-xs px-2 py-1 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void handleDelete(cat.id, cat._count?.expenses ?? 0)}
                          className="text-xs px-2 py-1 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
