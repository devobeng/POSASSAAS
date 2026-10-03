'use client';

import { useState } from 'react';
import { Package } from 'lucide-react';
import { useProducts, useDeleteProduct, useImportProductsCSV } from '@/hooks/api/useProducts';
import { useCategories } from '@/hooks/api/useCategories';
import { useUiStore } from '@/store/uiStore';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import ProductDrawer from '@/components/products/ProductDrawer';
import type { Product } from '@/types';
import Image from 'next/image';

export default function ProductsPage() {
  const toast = useUiStore((s) => s.toast);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useProducts({ search, page, limit: 20, categoryId: categoryFilter || undefined });
  const { data: categories } = useCategories();
  const { mutate: deleteProduct, isPending: isDeleting } = useDeleteProduct(deleteId ?? '');
  const { mutateAsync: importCSV, isPending: isImporting } = useImportProductsCSV();

  const columns: Column<Product>[] = [
    {
      key: 'image',
      header: '',
      className: 'w-10',
      render: (p) =>
        p.imageUrl ? (
          <Image src={p.imageUrl} alt={p.name} width={36} height={36} className="w-9 h-9 rounded-lg object-cover" />
        ) : (
          <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <Package className="w-4 h-4 text-gray-400" />
          </div>
        ),
    },
    {
      key: 'name',
      header: 'Product',
      render: (p) => (
        <div>
          <p className="font-medium">{p.name}</p>
          <p className="text-xs text-gray-400">{p.sku}</p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (p) => <span className="text-gray-500 dark:text-gray-400 text-xs">{p.category?.name ?? '—'}</span>,
    },
    {
      key: 'sellingPrice',
      header: 'Price',
      render: (p) => (parseFloat(p.sellingPrice) / 100).toFixed(2),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (p) => <Badge label={p.isActive ? 'Active' : 'Inactive'} variant={p.isActive ? 'success' : 'neutral'} />,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-24 text-right',
      render: (p) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => { setEditProduct(p); setDrawerOpen(true); }}
            className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
          >
            Edit
          </button>
          <button
            onClick={() => setDeleteId(p.id)}
            className="text-xs text-red-500 hover:underline"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await importCSV(file);
      toast(`Imported ${result.imported} products${result.errors.length ? `, ${result.errors.length} errors` : ''}`, result.errors.length ? 'warning' : 'success');
    } catch {
      toast('Import failed', 'error');
    }
    e.target.value = '';
    setImportOpen(false);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Products</h1>
        <div className="flex gap-2">
          <label className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
            <span>{isImporting ? 'Importing…' : 'Import CSV'}</span>
            <input type="file" accept=".csv" className="hidden" onChange={handleImport} disabled={isImporting} />
          </label>
          <button
            onClick={() => { setEditProduct(null); setDrawerOpen(true); }}
            className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium"
          >
            + New product
          </button>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setCategoryFilter('')}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${!categoryFilter ? 'bg-primary-600 text-white border-primary-600' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-primary-400'}`}
        >
          All
        </button>
        {categories?.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategoryFilter(c.id === categoryFilter ? '' : c.id)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${categoryFilter === c.id ? 'bg-primary-600 text-white border-primary-600' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-primary-400'}`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        keyExtractor={(p) => p.id}
        pagination={data?.meta}
        onPageChange={setPage}
        search={search}
        onSearch={(q) => { setSearch(q); setPage(1); }}
        searchPlaceholder="Search by name or SKU…"
        emptyMessage="No products yet"
        emptyDescription="Create your first product to get started"
      />

      <ProductDrawer
        open={drawerOpen}
        product={editProduct}
        onClose={() => { setDrawerOpen(false); setEditProduct(null); }}
      />

      <Modal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete product"
        description="This will permanently remove the product. Existing order history is retained."
        confirmLabel="Delete"
        destructive
        isLoading={isDeleting}
        onConfirm={() =>
          deleteProduct(undefined, {
            onSuccess: () => { setDeleteId(null); toast('Product deleted', 'success'); },
            onError: () => toast('Failed to delete product', 'error'),
          })
        }
      />
    </div>
  );
}
