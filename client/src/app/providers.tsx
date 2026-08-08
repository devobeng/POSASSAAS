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
  const [ready, setReady] = useState(false);

  // zustand's persist middleware reads the saved `user` from localStorage
  // asynchronously, after this component's first render. If we make the
  // ready/not-ready decision before that rehydration lands, `user` still
  // reads as null, so we take the "no session" branch and mark the app
  // ready immediately — permanently skipping the token refresh below and
  // leaving accessToken null. Every request after that goes out with no
  // Authorization header at all. Wait for hydration to actually finish
  // before deciding anything.
  //
  // `useAuthStore.persist` only exists in the browser: its storage getter
  // is `() => localStorage`, which throws during SSR (no `localStorage` in
  // Node) — zustand swallows that and skips attaching `.persist` entirely.
  // Treat "no persist API" as "nothing to wait for" rather than crashing.
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist?.hasHydrated() ?? true);

  useEffect(() => {
    if (hydrated) return;
    if (!useAuthStore.persist || useAuthStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useAuthStore.persist.onFinishHydration(() => setHydrated(true));
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;

    // Read imperatively via getState(), NOT the reactive useAuthStore(selector)
    // hook. React's useSyncExternalStore deliberately returns the SSR-safe
    // (null) snapshot on the render where `hydrated` first flips true, to
    // avoid a hydration mismatch — so the reactive `user`/`accessToken`
    // values still lag one render behind the real, just-hydrated store state
    // at exactly the moment this effect needs them. getState() always reads
    // the true current state and has no such lag.
    const { user, accessToken } = useAuthStore.getState();

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
  }, [hydrated]); // re-run once hydration completes; accessToken/user are stable by then

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
