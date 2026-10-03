'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useCartStore } from './cartStore';
import type { User } from '../types';

const FLAG_COOKIE = 'pos-auth';

// The cookie's value is the user's role, not just a boolean — role names
// aren't sensitive, and both the Edge middleware and the root page are
// server-side code with no access to the Zustand store, so this is the only
// way they can send a SUPER_ADMIN (who has no storeId, and for whom every
// per-store /dashboard call 400s) to /admin instead of /dashboard.
function setSessionCookie(role: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${FLAG_COOKIE}=${role}; path=/; SameSite=Lax`;
}

function clearSessionCookie() {
  if (typeof document === 'undefined') return;
  document.cookie = `${FLAG_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

// Decode JWT expiry without a library — tokens are base64url-encoded JSON.
function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// ── Silent refresh ────────────────────────────────────────────────────────────
// Proactively refresh the access token 90 seconds before it expires so the
// user never hits a 401 mid-session. The timer is reset whenever a new token
// is stored and cancelled on logout.

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRefresh(token: string) {
  if (typeof window === 'undefined') return;
  if (refreshTimer) clearTimeout(refreshTimer);

  const exp = getTokenExpiry(token);
  if (!exp) return;

  const msUntilRefresh = exp - Date.now() - 90_000; // 90 s before expiry
  if (msUntilRefresh <= 0) {
    // Token already expired or about to — refresh immediately
    triggerSilentRefresh();
    return;
  }

  refreshTimer = setTimeout(triggerSilentRefresh, msUntilRefresh);
}

async function triggerSilentRefresh() {
  try {
    // Dynamic import avoids circular deps (axios imports authStore)
    const { default: api } = await import('../lib/axios');
    const { data } = await api.post<{ data: { accessToken: string } }>('/auth/refresh');
    const newToken = data.data.accessToken;
    useAuthStore.getState().updateAccessToken(newToken);
    scheduleRefresh(newToken);
  } catch {
    // Refresh failed (refresh token expired) — clear auth so the user is
    // redirected to login on the next navigation, but don't force-redirect
    // here since a cashier in the middle of a sale shouldn't be kicked out.
    useAuthStore.getState().clearAuth();
  }
}

// ─────────────────────────────────────────────────────────────────────────────

interface AuthState {
  user: User | null;
  accessToken: string | null;
  setAuth: (user: User, accessToken: string) => void;
  updateAccessToken: (token: string) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,

      setAuth: (user, accessToken) => {
        setSessionCookie(user.role);
        set({ user, accessToken });
        scheduleRefresh(accessToken);
      },

      updateAccessToken: (accessToken) => {
        set({ accessToken });
        scheduleRefresh(accessToken);
      },

      clearAuth: () => {
        if (refreshTimer) {
          clearTimeout(refreshTimer);
          refreshTimer = null;
        }
        clearSessionCookie();
        set({ user: null, accessToken: null });
        // A logged-out (or force-logged-out) session should never leave a
        // cashier's in-progress sale sitting around for the next person who
        // logs in on this device/terminal.
        useCartStore.getState().clearCart();
      },

      isAuthenticated: () => !!get().user && !!get().accessToken,
    }),
    {
      name: 'pos-auth-store',
      // Only persist user — access tokens are short-lived; fetch fresh via refresh
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
