'use client';

import { useEffect } from 'react';
import { useConnectivityStore } from '@/store/connectivityStore';

// Strip /api/v1 suffix to hit the root healthz endpoint
const HEALTHZ_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000/api/v1'
).replace(/\/api\/v1\/?$/, '/healthz');

async function probe(): Promise<boolean> {
  try {
    await fetch(HEALTHZ_URL, { method: 'HEAD', cache: 'no-store' });
    return true;
  } catch {
    return false;
  }
}

export function useConnectivity() {
  const setStatus = useConnectivityStore((s) => s.setStatus);

  useEffect(() => {
    let heartbeatId: ReturnType<typeof setInterval>;

    const check = async () => {
      const alive = await probe();
      const current = useConnectivityStore.getState().status;
      if (alive) {
        // Don't stomp 'syncing' — sync engine transitions back to 'online' when done
        if (current === 'offline') setStatus('online');
      } else {
        setStatus('offline');
      }
    };

    const handleOnline = () => check();
    const handleOffline = () => setStatus('offline');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Immediate probe, then every 30 s
    check();
    heartbeatId = setInterval(check, 30_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(heartbeatId);
    };
  }, [setStatus]);
}
