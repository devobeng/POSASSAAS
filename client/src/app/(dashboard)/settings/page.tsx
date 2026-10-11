'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Store as StoreIcon } from 'lucide-react';
import { useStore, useUpdateStore, useUploadLogo } from '@/hooks/api/useStore';
import { useUiStore } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import { getErrorMessage } from '@/lib/errors';
import { blockInvalidNumberKey } from '@/lib/numericInput';
import Image from 'next/image';

function trialDaysLeft(trialEndsAt: string | null | undefined): number | null {
  if (!trialEndsAt) return null;
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default function SettingsPage() {
  const toast = useUiStore((s) => s.toast);
  const user = useAuthStore((s) => s.user);
  const { data: store, isLoading } = useStore();
  const { mutateAsync: updateStore, isPending: saving } = useUpdateStore();
  const { mutateAsync: uploadLogo, isPending: uploading } = useUploadLogo();

  const [form, setForm] = useState({ name: '', currency: '', stockAdjustmentThreshold: '20' });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (store) {
      setForm({
        name: store.name,
        currency: store.currency ?? 'GHS',
        stockAdjustmentThreshold: String(store.stockAdjustmentThreshold ?? 20),
      });
      setLogoPreview(store.logoUrl ?? null);
    }
  }, [store]);

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: Parameters<typeof updateStore>[0] = { name: form.name, currency: form.currency };
      if (user?.role === 'STORE_ADMIN') {
        const threshold = parseInt(form.stockAdjustmentThreshold, 10);
        if (Number.isFinite(threshold) && threshold > 0) {
          payload.stockAdjustmentThreshold = threshold;
        }
      }
      await updateStore(payload);
      if (logoFile) {
        await uploadLogo(logoFile);
        setLogoFile(null);
      }
      toast('Settings saved', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to save settings'), 'error');
    }
  };

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(n=><div key={n} className="h-10 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"/>)}</div>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          {/* Logo */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Store logo</h2>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center overflow-hidden shrink-0 border border-gray-200 dark:border-gray-700">
                {logoPreview ? (
                  <Image src={logoPreview} alt="Logo" width={80} height={80} className="w-full h-full object-cover" />
                ) : (
                  <StoreIcon className="w-8 h-8 text-gray-400" />
                )}
              </div>
              <div className="space-y-1">
                <button type="button" onClick={() => fileRef.current?.click()} className="text-sm text-primary-600 dark:text-primary-400 hover:underline">
                  {logoPreview ? 'Change logo' : 'Upload logo'}
                </button>
                <p className="text-xs text-gray-400">PNG or JPG, recommended 512×512</p>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoSelect} />
              </div>
            </div>
          </div>

          {/* Store info */}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Store information</h2>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Store name <span className="text-red-500">*</span></label>
              <input required type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Currency</label>
              <select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} className={inputClass}>
                <option value="GHS">GHS — Ghanaian Cedi</option>
                <option value="NGN">NGN — Nigerian Naira</option>
                <option value="KES">KES — Kenyan Shilling</option>
                <option value="USD">USD — US Dollar</option>
              </select>
            </div>
          </div>

          {/* Anti-theft: stock adjustment approval threshold */}
          {user?.role === 'STORE_ADMIN' && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Stock adjustment approval</h2>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Branch manager approval threshold
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.stockAdjustmentThreshold}
                  onChange={(e) => setForm((f) => ({ ...f, stockAdjustmentThreshold: e.target.value }))}
                  onKeyDown={(e) => blockInvalidNumberKey(e, { allowDecimal: false })}
                  className={inputClass}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Branch managers can adjust stock freely up to this quantity. Adjustments above it are sent to you for approval before they take effect.
                </p>
              </div>
            </div>
          )}

          {/* Subscription info */}
          {store && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Subscription</h2>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Plan</span>
                  <span className="font-medium">{store.subscriptionPlan?.name ?? 'Free'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <span className={`font-medium ${
                    store.subscriptionStatus === 'ACTIVE' ? 'text-green-600'
                    : store.subscriptionStatus === 'EXPIRED' || store.subscriptionStatus === 'CANCELLED' ? 'text-red-600'
                    : 'text-yellow-600'
                  }`}>
                    {store.subscriptionStatus}
                  </span>
                </div>
                {store.subscriptionStatus === 'TRIAL' && trialDaysLeft(store.trialEndsAt) !== null && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Trial</span>
                    <span className="font-medium">{trialDaysLeft(store.trialEndsAt)} day(s) left</span>
                  </div>
                )}
                {store.currentPeriodEnd && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Paid until (Mobile Money)</span>
                    <span className="font-medium">
                      {new Date(store.currentPeriodEnd).toLocaleDateString()}
                      {store.subscriptionStatus === 'ACTIVE' &&
                        ` · ${trialDaysLeft(store.currentPeriodEnd)} day(s) left`}
                    </span>
                  </div>
                )}
                <Link
                  href="/select-plan"
                  className="inline-block mt-1 text-sm text-primary-600 dark:text-primary-400 hover:underline"
                >
                  {store.subscriptionStatus === 'EXPIRED'
                    ? store.currentPeriodEnd ? 'Renew →' : 'Choose a plan →'
                    : store.currentPeriodEnd ? 'Renew or change plan →' : 'Change plan →'}
                </Link>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button type="submit" disabled={saving || uploading} className="px-5 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {saving || uploading ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
