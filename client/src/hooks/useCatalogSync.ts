'use client';

import { useEffect, useRef } from 'react';
import api from '@/lib/axios';
import { db, type CachedProduct, type CachedCategory, type CachedInventory } from '@/lib/db';
import { useConnectivityStore } from '@/store/connectivityStore';

const SYNC_INTERVAL_MS = 5 * 60_000; // 5 minutes

export function useCatalogSync(branchId: string | null) {
  const status = useConnectivityStore((s) => s.status);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!branchId) return;

    const sync = async () => {
      if (statusRef.current === 'offline') return;
      try {
        const meta = await db.syncMeta.get('catalog');
        const params: Record<string, string> = { branchId };
        if (meta?.lastSyncAt) params.since = meta.lastSyncAt;

        const res = await api.get('/sync/catalog', { params });
        const { categories, products, inventory, syncedAt } = res.data.data as {
          categories: CachedCategory[];
          products: CachedProduct[];
          inventory: CachedInventory[];
          syncedAt: string;
        };

        await db.transaction('rw', [db.products, db.categories, db.inventory, db.syncMeta], async () => {
          if (categories?.length) {
            await db.categories.bulkPut(
              categories.map((c) => ({ ...c, updatedAt: String(c.updatedAt) })),
            );
          }
          if (products?.length) {
            await db.products.bulkPut(
              products.map((p) => ({ ...p, updatedAt: String(p.updatedAt) })),
            );
          }
          if (inventory?.length) {
            await db.inventory.bulkPut(
              inventory.map((i) => ({ ...i, updatedAt: String(i.updatedAt) })),
            );
          }
          await db.syncMeta.put({ key: 'catalog', lastSyncAt: syncedAt });
        });
      } catch {
        // Silent — stale catalog keeps the POS running
      }
    };

    sync();
    const id = setInterval(sync, SYNC_INTERVAL_MS);

    // Re-sync as soon as the cashier comes back to this tab/window — otherwise
    // stock changed elsewhere (e.g. an admin just adjusted inventory) wouldn't
    // show up here until the next 5-minute tick or a full page reload.
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', sync);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', sync);
    };
  }, [branchId]);
}
