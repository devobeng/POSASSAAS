'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, useEffect } from 'react';
import { queryClient } from '../lib/queryClient';
import { useAuthStore } from '../store/authStore';

// On page reload, Zustand restores `user` from localStorage but `accessToken`
// is null (not persisted). We must bootstrap a fresh token before any queries
// fire — if we let queries run with no token they all 401, which races against
// our own refresh and causes the rotation to conflict.
//
// This component blocks rendering until we know whether we have a valid token:
//  - Already have one  → show app immediately
//  - Have persisted user but no token → refresh first, then show
//  - No user at all    → show immediately (Next.js middleware redirects to /login)

function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Already have a token in memory — schedule proactive refresh and show app
    if (accessToken) {
      // updateAccessToken schedules the background refresh timer internally
      useAuthStore.getState().updateAccessToken(accessToken);
      setReady(true);
      return;
    }

    // No persisted user — let Next.js middleware handle the redirect to /login
    if (!user) {
      setReady(true);
      return;
    }

    // User is persisted but token is gone (page reload). Get a fresh token
    // before any child components mount and fire queries.
    let cancelled = false;
    import('../lib/axios').then(({ default: api }) => {
      api
        .post<{ data: { accessToken: string } }>('/auth/refresh')
        .then(({ data }) => {
          if (!cancelled) {
            useAuthStore.getState().updateAccessToken(data.data.accessToken);
          }
        })
        .catch(() => {
          // Refresh token expired — clear auth; middleware redirects to /login
          if (!cancelled) useAuthStore.getState().clearAuth();
        })
        .finally(() => {
          if (!cancelled) setReady(true);
        });
    });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="w-8 h-8 rounded-full border-4 border-primary-200 border-t-primary-600 animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionBootstrap>{children}</SessionBootstrap>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
