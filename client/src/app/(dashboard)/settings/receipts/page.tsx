'use client';

import { useState, useEffect } from 'react';
import { useReceiptSettings, useUpdateReceiptSettings } from '@/hooks/api/useReceiptSettings';
import { useUiStore } from '@/store/uiStore';

export default function ReceiptSettingsPage() {
  const { data, isLoading } = useReceiptSettings();
  const { mutateAsync: save, isPending: saving } = useUpdateReceiptSettings();
  const toast = useUiStore((s) => s.toast);

  const [form, setForm] = useState({
    headerText:             '',
    footerText:             '',
    paperWidth:             80 as 58 | 80,
    showLogo:               true,
    showQrCode:             true,
    weightedBarcodeEnabled: false,
    weightedBarcodeType:    'price' as 'price' | 'weight',
  });

  useEffect(() => {
    if (data) {
      setForm({
        headerText:             data.headerText ?? '',
        footerText:             data.footerText ?? '',
        paperWidth:             (data.paperWidth === 58 ? 58 : 80) as 58 | 80,
        showLogo:               data.showLogo,
        showQrCode:             data.showQrCode,
        weightedBarcodeEnabled: data.weightedBarcodeEnabled,
        weightedBarcodeType:    data.weightedBarcodeType ?? 'price',
      });
    }
  }, [data]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await save({
        ...form,
        headerText: form.headerText || null,
        footerText: form.footerText || null,
      });
      toast('Receipt settings saved', 'success');
    } catch {
      toast('Failed to save receipt settings', 'error');
    }
  };

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

  const Toggle = ({
    label, desc, value, onChange,
  }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${value ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'}`}
        role="switch"
        aria-checked={value}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${value ? 'translate-x-5' : 'translate-x-0.5'}`}
        />
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="p-6 max-w-2xl space-y-4">
        {[1,2,3,4].map((n) => (
          <div key={n} className="h-12 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">Receipt settings</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
        Applied to all receipts for this store — printed and digital.
      </p>

      <form onSubmit={handleSave} className="space-y-8">
        {/* Text customisation */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Custom text</h2>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Header (top of receipt)</label>
            <input
              type="text"
              maxLength={200}
              placeholder="e.g. Thank you for shopping with us!"
              value={form.headerText}
              onChange={(e) => setForm((f) => ({ ...f, headerText: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Footer (bottom of receipt)</label>
            <input
              type="text"
              maxLength={200}
              placeholder="e.g. No returns after 24 hours"
              value={form.footerText}
              onChange={(e) => setForm((f) => ({ ...f, footerText: e.target.value }))}
              className={inputClass}
            />
          </div>
        </div>

        {/* Paper width */}
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Paper width</h2>
          <div className="flex gap-3">
            {([58, 80] as (58 | 80)[]).map((w) => (
              <label
                key={w}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                  form.paperWidth === w
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="paperWidth"
                  checked={form.paperWidth === w}
                  onChange={() => setForm((f) => ({ ...f, paperWidth: w }))}
                  className="accent-primary-600"
                />
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {w}mm
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            58mm for small desktop printers · 80mm for standard thermal printers
          </p>
        </div>

        {/* Toggles */}
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Options</h2>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
            <div className="px-4">
              <Toggle
                label="Show store logo"
                desc="Prints the store logo at the top (requires logo upload)"
                value={form.showLogo}
                onChange={(v) => setForm((f) => ({ ...f, showLogo: v }))}
              />
            </div>
            <div className="px-4">
              <Toggle
                label="Show QR code"
                desc="Prints a QR code of the order number for digital lookup"
                value={form.showQrCode}
                onChange={(v) => setForm((f) => ({ ...f, showQrCode: v }))}
              />
            </div>
            <div className="px-4">
              <Toggle
                label="Weighted barcodes"
                desc="EAN-13 barcodes starting with '2' contain an embedded price or weight"
                value={form.weightedBarcodeEnabled}
                onChange={(v) => setForm((f) => ({ ...f, weightedBarcodeEnabled: v }))}
              />
            </div>
          </div>

          {form.weightedBarcodeEnabled && (
            <div className="mt-3 px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Embedded value type</p>
              <div className="flex gap-4">
                {(['price', 'weight'] as const).map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="weightedBarcodeType"
                      checked={form.weightedBarcodeType === t}
                      onChange={() => setForm((f) => ({ ...f, weightedBarcodeType: t }))}
                      className="accent-primary-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">{t}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1.5">
                {form.weightedBarcodeType === 'price'
                  ? 'Digits 6–10 of the barcode are the price in cents (e.g. 01500 = 15.00)'
                  : 'Digits 6–10 are weight in grams (e.g. 01500 = 1.5 kg)'}
              </p>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </form>
    </div>
  );
}
