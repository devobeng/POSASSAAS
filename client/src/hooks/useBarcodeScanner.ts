'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useCartStore } from '@/store/cartStore';
import { useUiStore } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import {
  GlobalBarcodeCapture,
  playScanBeep,
  parseWeightedBarcode,
  type WeightedBarcodeResult,
} from '@/lib/barcodeCapture';

interface Options {
  weightedBarcodeEnabled?: boolean;
  weightedBarcodeType?: 'price' | 'weight';
  onNoMatch?: (barcode: string) => void;
}

export function useBarcodeScanner(opts: Options = {}) {
  const addItem    = useCartStore((s) => s.addItem);
  const toast      = useUiStore((s) => s.toast);
  const user       = useAuthStore((s) => s.user);
  const captureRef = useRef<GlobalBarcodeCapture | null>(null);

  const allProducts = useLiveQuery(() => db.products.toArray(), []);

  const handleScan = useCallback((barcode: string) => {
    if (!allProducts) return;

    playScanBeep();

    // ── Weighted barcode (EAN-13 starting with '2') ────────────────────────
    if (opts.weightedBarcodeEnabled && barcode.startsWith('2') && barcode.length === 13) {
      const parsed: WeightedBarcodeResult | null = parseWeightedBarcode(
        barcode,
        opts.weightedBarcodeType ?? 'price',
      );
      if (parsed) {
        // Find product by the 5-digit embedded code (matched against last 5 chars of barcode field or SKU)
        const product = allProducts.find(
          (p) =>
            p.barcode?.slice(1, 6) === parsed.productCode ||
            p.sku.endsWith(parsed.productCode),
        );
        if (product) {
          const qty = parsed.type === 'weight'
            ? Math.max(1, Math.round(parsed.value / 1000))  // grams → kg quantity
            : 1;  // for price-embedded: qty = 1, price override would need cart store changes
          // Add to cart as normal product (price override is a complex store change; leave for now)
          addItem(
            {
              id: product.id,
              name: product.name,
              sku: product.sku,
              barcode: product.barcode,
              imageUrl: product.imageUrl,
              sellingPrice: String(product.sellingPrice),
              taxRate: String(product.taxRate),
              isActive: true,
              storeId: '',
              categoryId: product.categoryId,
              costPrice: '0',
            },
            qty,
          );
          return;
        }
      }
    }

    // ── Exact barcode match ────────────────────────────────────────────────
    const product = allProducts.find((p) => p.barcode === barcode);
    if (product) {
      addItem({
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        imageUrl: product.imageUrl,
        sellingPrice: String(product.sellingPrice),
        taxRate: String(product.taxRate),
        isActive: true,
        storeId: '',
        categoryId: product.categoryId,
        costPrice: '0',
      });
      return;
    }

    // ── No match ───────────────────────────────────────────────────────────
    const isAdmin = user?.role === 'STORE_ADMIN' || user?.role === 'BRANCH_MANAGER';
    if (opts.onNoMatch) {
      opts.onNoMatch(barcode);
    } else {
      toast(
        isAdmin
          ? `Barcode "${barcode}" not found. Go to Products to add it.`
          : `Barcode "${barcode}" not found`,
        'error',
      );
    }
  }, [allProducts, addItem, toast, user, opts]);

  useEffect(() => {
    const capture = new GlobalBarcodeCapture({ maxInterKeyMs: 30, minLength: 4 });
    captureRef.current = capture;
    capture.on(handleScan);
    capture.start();
    return () => {
      capture.off(handleScan);
      capture.stop();
    };
  }, [handleScan]);

  return { handleScan };
}
