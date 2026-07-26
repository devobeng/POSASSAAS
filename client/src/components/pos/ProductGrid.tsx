'use client';

import { useState, useMemo, type RefObject, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCartStore } from '@/store/cartStore';
import { db, type CachedProduct } from '@/lib/db';
import ProductCard from './ProductCard';

// Shape usable by cartStore.addItem (mirrors the Product type cartStore expects)
function toProduct(p: CachedProduct) {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    imageUrl: p.imageUrl,
    sellingPrice: String(p.sellingPrice),  // pesewas as string — cartStore parses it
    taxRate: String(p.taxRate),
    isActive: true,
    storeId: '',
    categoryId: p.categoryId,
    costPrice: '0',
  } as const;
}

interface Props {
  searchRef: RefObject<HTMLInputElement>;
  branchId: string;
}

export default function ProductGrid({ searchRef }: Props) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const addItem = useCartStore((s) => s.addItem);
  const cartItems = useCartStore((s) => s.items);

  // Live queries — re-render automatically when IndexedDB data changes (sync, etc.)
  const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), []);
  const allProducts = useLiveQuery(
    () =>
      selectedCategory
        ? db.products.where('categoryId').equals(selectedCategory).toArray()
        : db.products.toArray(),
    [selectedCategory],
  );
  const inventoryItems = useLiveQuery(() => db.inventory.toArray(), []);

  const isLoaded = categories !== undefined && allProducts !== undefined;

  // productId → stock
  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    (inventoryItems ?? []).forEach((i) => map.set(i.productId, i.quantity));
    return map;
  }, [inventoryItems]);

  // productId → qty already in cart
  const cartQtyMap = useMemo(() => {
    const map = new Map<string, number>();
    cartItems.forEach((i) => map.set(i.productId, i.quantity));
    return map;
  }, [cartItems]);

  // barcode → product (for scanner Enter handler)
  const barcodeMap = useMemo(() => {
    const map = new Map<string, CachedProduct>();
    (allProducts ?? []).forEach((p) => { if (p.barcode) map.set(p.barcode, p); });
    return map;
  }, [allProducts]);

  const filtered = useMemo(() => {
    const all = allProducts ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.includes(q)),
    );
  }, [allProducts, search]);

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const barcode = search.trim();
    const product = barcodeMap.get(barcode);
    if (product && (stockMap.get(product.id) ?? 0) > (cartQtyMap.get(product.id) ?? 0)) {
      addItem(toProduct(product));
      setSearch('');
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* Search bar */}
      <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search products or scan barcode (↵)   F2"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1.5 px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto shrink-0 scrollbar-none">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
            !selectedCategory
              ? 'bg-primary-600 text-white'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          All
        </button>
        {(categories ?? []).map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              selectedCategory === cat.id
                ? 'bg-primary-600 text-white'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {!isLoaded ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[3/4] bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <Search className="w-8 h-8 mb-2 text-gray-300 dark:text-gray-700" />
            <p className="text-sm text-gray-400">
              {(allProducts?.length ?? 0) === 0
                ? 'Catalog loading… go online to sync products'
                : 'No products found'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
            {filtered.map((product) => (
              <ProductCard
                key={product.id}
                product={toProduct(product)}
                stock={stockMap.get(product.id) ?? 0}
                cartQty={cartQtyMap.get(product.id) ?? 0}
                onAdd={() => addItem(toProduct(product))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
