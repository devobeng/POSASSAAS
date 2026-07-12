'use client';

import { useCallback } from 'react';
import api from '@/lib/axios';

export function useAuditDrawer() {
  const logDrawerOpen = useCallback(async () => {
    try {
      // POST to a lightweight audit endpoint; fire-and-forget
      await api.post('/store/audit', {
        action: 'DRAWER_OPENED',
        entity: 'CashDrawer',
        entityId: 'manual',
      });
    } catch {
      // Non-fatal — drawer still opened; audit failure shouldn't block cashier
    }
  }, []);

  return { logDrawerOpen };
}
