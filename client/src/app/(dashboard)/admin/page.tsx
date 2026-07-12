'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { redirect } from 'next/navigation';
import { useAdminStores, usePlatformStats, useSuspendStore, useActivateStore, useSubscriptionPlans, useCreatePlan, useDeletePlan } from '@/hooks/api/useAdmin';
import { useUiStore } from '@/store/uiStore';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import Drawer from '@/components/ui/Drawer';

interface StoreRow {
  id: string; name: string; slug: string;
  subscriptionPlan: string; subscriptionStatus: string;
  _count?: { users?: number; branches?: number };
}

interface Plan {
  id: string; name: string; price: number;
  maxBranches: number; maxUsers: number; features: unknown;
}

export default function AdminPage() {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== 'SUPER_ADMIN') { redirect('/dashboard'); }

  const toast = useUiStore((s) => s.toast);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'stores' | 'plans'>('stores');
  const [suspendId, setSuspendId] = useState<string | null>(null);
  const [activateId, setActivateId] = useState<string | null>(null);
  const [planDrawer, setPlanDrawer] = useState(false);
  const [deletePlanId, setDeletePlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({ name: '', price: '', maxBranches: '5', maxUsers: '20' });

  const { data: storesData, isLoading: storesLoading } = useAdminStores({ page, limit: 20 });
  const { data: stats } = usePlatformStats();
  const { data: plans, isLoading: plansLoading } = useSubscriptionPlans();
  const { mutate: suspendStore, isPending: suspending } = useSuspendStore(suspendId ?? '');
  const { mutate: activateStore, isPending: activating } = useActivateStore(activateId ?? '');
  const { mutateAsync: createPlan, isPending: creatingPlan } = useCreatePlan();
  const { mutate: deletePlan, isPending: deletingPlan } = useDeletePlan(deletePlanId ?? '');

  const storeColumns: Column<StoreRow>[] = [
    { key: 'name', header: 'Store', render: (s) => <div><p className="font-medium">{s.name}</p><p className="text-xs text-gray-400">{s.slug}</p></div> },
    { key: 'plan', header: 'Plan', render: (s) => <span className="text-sm capitalize">{s.subscriptionPlan?.toLowerCase()}</span> },
    { key: 'status', header: 'Status', render: (s) => <Badge label={s.subscriptionStatus} variant={s.subscriptionStatus === 'ACTIVE' ? 'success' : s.subscriptionStatus === 'PAST_DUE' ? 'warning' : 'neutral'} /> },
    { key: 'users', header: 'Users', render: (s) => <span className="text-sm">{s._count?.users ?? 0}</span> },
    { key: 'branches', header: 'Branches', render: (s) => <span className="text-sm">{s._count?.branches ?? 0}</span> },
    {
      key: 'actions', header: '', className: 'text-right w-32',
      render: (s) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {s.subscriptionStatus === 'ACTIVE' ? (
            <button onClick={() => setSuspendId(s.id)} className="text-xs text-yellow-600 hover:underline">Suspend</button>
          ) : (
            <button onClick={() => setActivateId(s.id)} className="text-xs text-green-600 hover:underline">Activate</button>
          )}
        </div>
      ),
    },
  ];

  const planColumns: Column<Plan>[] = [
    { key: 'name', header: 'Name', render: (p) => <span className="font-medium">{p.name}</span> },
    { key: 'price', header: 'Price', render: (p) => <span>GHS {(p.price / 100).toFixed(2)}/mo</span> },
    { key: 'maxBranches', header: 'Branches', render: (p) => <span>{p.maxBranches}</span> },
    { key: 'maxUsers', header: 'Users', render: (p) => <span>{p.maxUsers}</span> },
    {
      key: 'actions', header: '', className: 'text-right w-24',
      render: (p) => (
        <button onClick={(e) => { e.stopPropagation(); setDeletePlanId(p.id); }} className="text-xs text-red-500 hover:underline">Delete</button>
      ),
    },
  ];

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createPlan({
        name: planForm.name,
        price: Math.round(parseFloat(planForm.price) * 100),
        maxBranches: parseInt(planForm.maxBranches),
        maxUsers: parseInt(planForm.maxUsers),
        features: {},
      });
      toast('Plan created', 'success');
      setPlanDrawer(false);
      setPlanForm({ name: '', price: '', maxBranches: '5', maxUsers: '20' });
    } catch {
      toast('Failed to create plan', 'error');
    }
  };

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Super Admin</h1>

      {/* Platform stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total stores', val: String(stats.totalStores ?? 0) },
            { label: 'Active subs', val: String(stats.activeSubscriptions ?? 0) },
            { label: 'Total GMV', val: `GHS ${((stats.gmv ?? 0) / 100).toFixed(2)}` },
            { label: 'Total orders', val: String(stats.totalOrders ?? 0) },
          ].map((s) => (
            <div key={s.label} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-0.5">{s.val}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-100 dark:border-gray-800">
        {(['stores', 'plans'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${tab === t ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'stores' ? (
        <DataTable
          columns={storeColumns}
          data={storesData?.items ?? []}
          isLoading={storesLoading}
          keyExtractor={(s) => s.id}
          pagination={storesData?.meta}
          onPageChange={setPage}
          emptyMessage="No stores"
        />
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setPlanDrawer(true)} className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium">
              + New plan
            </button>
          </div>
          <DataTable
            columns={planColumns}
            data={plans ?? []}
            isLoading={plansLoading}
            keyExtractor={(p) => p.id}
            emptyMessage="No subscription plans"
          />
        </div>
      )}

      {/* Suspend modal */}
      <Modal
        open={!!suspendId}
        onClose={() => setSuspendId(null)}
        title="Suspend store"
        description="This store will be put in read-only mode. Users will not be able to create orders or make changes."
        confirmLabel="Suspend"
        destructive
        isLoading={suspending}
        onConfirm={() => suspendStore(undefined as never, {
          onSuccess: () => { setSuspendId(null); toast('Store suspended', 'success'); },
          onError: () => toast('Failed to suspend', 'error'),
        })}
      />

      {/* Activate modal */}
      <Modal
        open={!!activateId}
        onClose={() => setActivateId(null)}
        title="Activate store"
        description="This will restore full access to the store."
        confirmLabel="Activate"
        isLoading={activating}
        onConfirm={() => activateStore(undefined as never, {
          onSuccess: () => { setActivateId(null); toast('Store activated', 'success'); },
          onError: () => toast('Failed to activate', 'error'),
        })}
      />

      {/* Delete plan modal */}
      <Modal
        open={!!deletePlanId}
        onClose={() => setDeletePlanId(null)}
        title="Delete plan"
        description="This plan will be removed. Existing subscribers are not affected."
        confirmLabel="Delete"
        destructive
        isLoading={deletingPlan}
        onConfirm={() => deletePlan(undefined, {
          onSuccess: () => { setDeletePlanId(null); toast('Plan deleted', 'success'); },
          onError: () => toast('Failed to delete', 'error'),
        })}
      />

      {/* New plan drawer */}
      <Drawer
        open={planDrawer}
        onClose={() => setPlanDrawer(false)}
        title="New subscription plan"
        footer={
          <div className="flex gap-3 justify-end">
            <button onClick={() => setPlanDrawer(false)} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300">Cancel</button>
            <button form="plan-form" type="submit" disabled={creatingPlan} className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium disabled:opacity-50">
              {creatingPlan ? 'Creating…' : 'Create'}
            </button>
          </div>
        }
      >
        <form id="plan-form" onSubmit={handleCreatePlan} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Plan name <span className="text-red-500">*</span></label>
            <input required type="text" value={planForm.name} onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Starter" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Monthly price (GHS) <span className="text-red-500">*</span></label>
            <input required type="number" min="0" step="0.01" value={planForm.price} onChange={(e) => setPlanForm((f) => ({ ...f, price: e.target.value }))} placeholder="49.00" className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Max branches</label>
              <input type="number" min="1" value={planForm.maxBranches} onChange={(e) => setPlanForm((f) => ({ ...f, maxBranches: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Max users</label>
              <input type="number" min="1" value={planForm.maxUsers} onChange={(e) => setPlanForm((f) => ({ ...f, maxUsers: e.target.value }))} className={inputClass} />
            </div>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
