'use client';

import { useState, useMemo, useRef, useEffect, type RefObject, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCartStore } from '@/store/cartStore';
import { db, type CachedProduct } from '@/lib/db';
import ProductCard from './ProductCard';

// Mirrors the grid's own Tailwind breakpoints (grid-cols-2 sm:grid-cols-3
// xl:grid-cols-4) — the virtualizer below needs the actual column count as a
// number to chunk products into rows, since it virtualizes by row, not by
// individual card.
function useResponsiveColumnCount(): number {
  const [columns, setColumns] = useState(2);

  useEffect(() => {
    const sm = window.matchMedia('(min-width: 640px)');
    const xl = window.matchMedia('(min-width: 1280px)');
    const update = () => setColumns(xl.matches ? 4 : sm.matches ? 3 : 2);
    update();
    sm.addEventListener('change', update);
    xl.addEventListener('change', update);
    return () => {
      sm.removeEventListener('change', update);
      xl.removeEventListener('change', update);
    };
  }, []);

  return columns;
}

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnCount = useResponsiveColumnCount();

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

  // Virtualized by ROW, not by card — a large wholesale/pharmacy catalog
  // (thousands of SKUs) rendering every card into the DOM at once is what
  // causes visible jank on lower-end POS tablets. Grouping into rows of
  // `columnCount` lets the existing card grid markup stay unchanged per row.
  const rows = useMemo(() => {
    const chunks: (typeof filtered)[] = [];
    for (let i = 0; i < filtered.length; i += columnCount) {
      chunks.push(filtered.slice(i, i + columnCount));
    }
    return chunks;
  }, [filtered, columnCount]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    // Card is aspect-[3/4] plus the grid gap — a rough starting estimate;
    // measureElement (below) corrects it to the real rendered height per
    // row, which is what actually matters since card height depends on the
    // column count and the container's own width.
    estimateSize: () => 220,
    overscan: 3,
  });

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
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
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
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 pb-2"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {rows[virtualRow.index].map((product) => (
                  <ProductCard
                    key={product.id}
                    product={toProduct(product)}
                    stock={stockMap.get(product.id) ?? 0}
                    cartQty={cartQtyMap.get(product.id) ?? 0}
                    onAdd={() => addItem(toProduct(product))}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
