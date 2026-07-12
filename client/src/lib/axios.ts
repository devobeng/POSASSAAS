import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// ── Token-refresh queue ───────────────────────────────────────────────────────
// On 401 we attempt one token refresh. All concurrent requests that also
// fail with 401 during the refresh flight are queued and then replayed
// (or rejected) once the refresh settles.

let isRefreshing = false;

interface QueueEntry {
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}

let queue: QueueEntry[] = [];

function drainQueue(err: unknown, token?: string) {
  queue.forEach((e) => (err ? e.reject(err) : e.resolve(token!)));
  queue = [];
}

// ── Request interceptor: attach current access token ─────────────────────────

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAuthStore } = require('../store/authStore') as typeof import('../store/authStore');
    const token = useAuthStore.getState().accessToken;
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: retry with fresh token on 401 ──────────────────────

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Skip refresh loop for non-401 errors or if this is already a retry
    if (
      error.response?.status !== 401 ||
      original._retry ||
      original.url?.includes('/auth/refresh')
    ) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      // Queue this request and return a promise that re-runs it after refresh
      return new Promise<string>((resolve, reject) => {
        queue.push({ resolve, reject });
      }).then((token) => {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      // POST /auth/refresh sends the httpOnly refreshToken cookie automatically
      const { data } = await api.post<{ data: { accessToken: string } }>('/auth/refresh');
      const newToken = data.data.accessToken;

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useAuthStore } = require('../store/authStore') as typeof import('../store/authStore');
      useAuthStore.getState().updateAccessToken(newToken);

      drainQueue(null, newToken);
      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    } catch (refreshErr) {
      drainQueue(refreshErr);

      if (typeof window !== 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useAuthStore } = require('../store/authStore') as typeof import('../store/authStore');

        // Only redirect if we still have no valid token. If SessionBootstrap or
        // another concurrent refresh already obtained a new token, don't clear it.
        const currentToken = useAuthStore.getState().accessToken;
        if (!currentToken && navigator.onLine) {
          useAuthStore.getState().clearAuth();
          window.location.href = '/login';
        }
      }

      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  },
);

export default api;
