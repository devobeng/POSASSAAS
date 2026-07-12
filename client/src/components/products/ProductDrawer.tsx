'use client';

import { useState, useEffect, useRef } from 'react';
import Drawer from '@/components/ui/Drawer';
import { useCreateProduct, useUpdateProduct } from '@/hooks/api/useProducts';
import { useCategories } from '@/hooks/api/useCategories';
import { useUiStore } from '@/store/uiStore';
import api from '@/lib/axios';
import type { Product } from '@/types';
import Image from 'next/image';

interface Props {
  open: boolean;
  product: Product | null;
  onClose: () => void;
}

interface FormState {
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  costPrice: string;
  sellingPrice: string;
  taxRate: string;
  isActive: boolean;
}

const EMPTY: FormState = {
  name: '', sku: '', barcode: '', categoryId: '',
  costPrice: '', sellingPrice: '', taxRate: '0', isActive: true,
};

function toForm(p: Product): FormState {
  return {
    name: p.name,
    sku: p.sku,
    barcode: p.barcode ?? '',
    categoryId: p.categoryId ?? '',
    // Server stores in pesewas; show GHS in form
    costPrice: (parseFloat(p.costPrice) / 100).toFixed(2),
    sellingPrice: (parseFloat(p.sellingPrice) / 100).toFixed(2),
    taxRate: p.taxRate,
    isActive: p.isActive,
  };
}

export default function ProductDrawer({ open, product, onClose }: Props) {
  const toast = useUiStore((s) => s.toast);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: categories } = useCategories();
  const { mutateAsync: createProduct, isPending: isCreating } = useCreateProduct();
  const { mutateAsync: updateProduct, isPending: isUpdating } = useUpdateProduct(product?.id ?? '');

  const isEditing = !!product;
  const isPending = isCreating || isUpdating;

  useEffect(() => {
    if (open) {
      setForm(product ? toForm(product) : EMPTY);
      setImageFile(null);
      setImagePreview(product?.imageUrl ?? null);
    }
  }, [open, product]);

  const set = (key: keyof FormState, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Prices converted from GHS (form) → pesewas (server)
      const payload = {
        name: form.name,
        sku: form.sku || undefined,
        barcode: form.barcode || undefined,
        categoryId: form.categoryId || undefined,
        costPrice: Math.round(parseFloat(form.costPrice) * 100),
        sellingPrice: Math.round(parseFloat(form.sellingPrice) * 100),
        taxRate: parseFloat(form.taxRate) || 0,
        isActive: form.isActive,
      };

      const saved = isEditing
        ? await updateProduct(payload)
        : await createProduct(payload);

      // Upload image as separate multipart request after save
      if (imageFile && saved?.id) {
        try {
          const formData = new FormData();
          formData.append('image', imageFile);
          await api.patch(`/products/${saved.id}/image`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch {
          toast('Product saved but image upload failed', 'warning');
        }
      }

      toast(isEditing ? 'Product updated' : 'Product created', 'success');
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast(e.response?.data?.message ?? 'Failed to save product', 'error');
    }
  };

  const inputClass =
    'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

  const field = (
    label: string,
    key: keyof FormState,
    type = 'text',
    placeholder = '',
    required = false,
  ) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        required={required}
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
        className={inputClass}
      />
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEditing ? 'Edit product' : 'New product'}
      footer={
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            form="product-form"
            type="submit"
            disabled={isPending}
            className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium disabled:opacity-50"
          >
            {isPending ? 'Saving…' : isEditing ? 'Update' : 'Create'}
          </button>
        </div>
      }
    >
      <form id="product-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Image picker */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            Image
          </label>
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center overflow-hidden shrink-0">
              {imagePreview ? (
                <Image src={imagePreview} alt="preview" width={64} height={64} className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl">📦</span>
              )}
            </div>
            <div className="space-y-0.5">
              <button type="button" onClick={() => fileRef.current?.click()} className="block text-xs text-primary-600 dark:text-primary-400 hover:underline">
                {imagePreview ? 'Change image' : 'Upload image'}
              </button>
              {imagePreview && (
                <button type="button" onClick={() => { setImageFile(null); setImagePreview(null); }} className="block text-xs text-red-500 hover:underline">
                  Remove
                </button>
              )}
              <p className="text-[10px] text-gray-400">PNG, JPG up to 5 MB</p>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
            </div>
          </div>
        </div>

        {field('Product name', 'name', 'text', 'e.g. Cold Brew Coffee', true)}

        <div className="grid grid-cols-2 gap-3">
          {field('SKU', 'sku', 'text', 'Auto-generated if blank')}
          {field('Barcode', 'barcode', 'text', 'EAN / UPC')}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Category</label>
          <select
            value={form.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}
            className={inputClass}
          >
            <option value="">No category</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {field('Cost price (GHS)', 'costPrice', 'number', '0.00', true)}
          {field('Selling price (GHS)', 'sellingPrice', 'number', '0.00', true)}
          {field('Tax rate %', 'taxRate', 'number', '0')}
        </div>

        {/* Active toggle */}
        <div className="flex items-center gap-3 pt-1">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-gray-200 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600" />
          </label>
          <span className="text-sm text-gray-700 dark:text-gray-300">Active (visible on POS)</span>
        </div>
      </form>
    </Drawer>
  );
}
