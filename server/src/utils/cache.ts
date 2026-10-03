/**
 * Cache layer: uses the shared Redis client when REDIS_URL is set (and
 * reachable), falls back to an in-process Map otherwise or on any Redis
 * error — reads/writes must never throw or block on a Redis hiccup.
 */
import { redisClient } from '../config/redis';

interface Entry { data: unknown; expiresAt: number }
const memStore = new Map<string, Entry>();

export async function cacheGet(key: string): Promise<unknown | undefined> {
  if (redisClient) {
    const raw = await redisClient.get(key).catch(() => null);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  }
  const entry = memStore.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { memStore.delete(key); return undefined; }
  return entry.data;
}

export async function cacheSet(key: string, data: unknown, ttlMs = 60_000): Promise<void> {
  if (redisClient) {
    await redisClient.set(key, JSON.stringify(data), 'EX', Math.ceil(ttlMs / 1000)).catch(() => null);
    return;
  }
  memStore.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export async function cacheDel(key: string): Promise<void> {
  if (redisClient) { await redisClient.del(key).catch(() => null); return; }
  memStore.delete(key);
}

/** Test-only: the in-process fallback (used whenever REDIS_URL isn't set,
 *  which is how tests run) is a module-level singleton that otherwise leaks
 *  cached values between tests in the same file/process. */
export function __clearInMemoryCacheForTests(): void {
  memStore.clear();
}
