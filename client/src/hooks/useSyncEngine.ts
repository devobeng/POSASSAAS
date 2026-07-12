'use client';

import { useEffect, useRef } from 'react';
import api from '@/lib/axios';
import { db } from '@/lib/db';
import { useConnectivityStore } from '@/store/connectivityStore';

const BATCH_SIZE = 20;
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;  // 5 minutes
const MAX_RETRIES = 5;
const POLL_INTERVAL_MS = 10_000;

interface SyncResult {
  clientOrderId: string;
  status: 'created' | 'duplicate' | 'failed';
  error?: string;
}

export function useSyncEngine() {
  const setStatus = useConnectivityStore((s) => s.setStatus);
  const setPendingCount = useConnectivityStore((s) => s.setPendingCount);
  const setFailedCount = useConnectivityStore((s) => s.setFailedCount);
  const statusRef = useRef(useConnectivityStore.getState().status);
  const backoffMs = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  // Keep statusRef current
  useEffect(() => {
    return useConnectivityStore.subscribe((state) => {
      statusRef.current = state.status;
    });
  }, []);

  // Update counts periodically
  useEffect(() => {
    const refreshCounts = async () => {
      const [pending, failed] = await Promise.all([
        db.pendingOrders.count(),
        db.failedOrders.count(),
      ]);
      setPendingCount(pending);
      setFailedCount(failed);
    };

    refreshCounts();
    const id = setInterval(refreshCounts, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [setPendingCount, setFailedCount]);

  // Main sync loop
  useEffect(() => {
    const scheduleNext = (delayMs: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(runSync, delayMs);
    };

    const runSync = async () => {
      if (runningRef.current || statusRef.current === 'offline') {
        scheduleNext(POLL_INTERVAL_MS);
        return;
      }

      // Find orders eligible for retry (nextRetryAt <= now)
      const now = Date.now();
      const eligible = await db.pendingOrders
        .where('nextRetryAt')
        .belowOrEqual(now)
        .limit(BATCH_SIZE)
        .toArray();

      if (eligible.length === 0) {
        scheduleNext(POLL_INTERVAL_MS);
        return;
      }

      runningRef.current = true;
      setStatus('syncing');

      try {
        const res = await api.post<{ data: { results: SyncResult[] } }>('/sync/orders', {
          orders: eligible.map((o) => o.payload),
        });

        const results = res.data.data.results;
        backoffMs.current = 0; // network succeeded — reset backoff

        await db.transaction('rw', [db.pendingOrders, db.failedOrders], async () => {
          for (const result of results) {
            const order = eligible.find((o) => o.clientOrderId === result.clientOrderId);
            if (!order || order._localId === undefined) continue;

            if (result.status === 'created' || result.status === 'duplicate') {
              await db.pendingOrders.delete(order._localId);
            } else {
              const retryCount = order.retryCount + 1;
              if (retryCount >= MAX_RETRIES) {
                await db.failedOrders.add({
                  clientOrderId: order.clientOrderId,
                  payload: order.payload,
                  error: result.error ?? 'Unknown error',
                  failedAt: new Date().toISOString(),
                });
                await db.pendingOrders.delete(order._localId);
              } else {
                const nextBackoff = BASE_BACKOFF_MS * Math.pow(2, retryCount);
                await db.pendingOrders.update(order._localId, {
                  retryCount,
                  nextRetryAt: Date.now() + nextBackoff,
                });
              }
            }
          }
        });
      } catch {
        // Network or server error — back off
        backoffMs.current = Math.min(
          (backoffMs.current || BASE_BACKOFF_MS) * 2,
          MAX_BACKOFF_MS,
        );
      } finally {
        runningRef.current = false;

        const [pending, failed] = await Promise.all([
          db.pendingOrders.count(),
          db.failedOrders.count(),
        ]);
        setPendingCount(pending);
        setFailedCount(failed);

        const remaining = await db.pendingOrders.where('nextRetryAt').belowOrEqual(Date.now()).count();
        if (remaining === 0 && statusRef.current === 'syncing') setStatus('online');

        const delay = backoffMs.current || POLL_INTERVAL_MS;
        scheduleNext(delay);
      }
    };

    scheduleNext(0);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [setStatus, setPendingCount, setFailedCount]);
}
