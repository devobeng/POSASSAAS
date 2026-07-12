/**
 * Cache layer: uses Redis when REDIS_URL is set, falls back to in-process Map.
 * To enable Redis: npm install ioredis — no other code changes needed.
 */
import { env } from '../config/env';
import { logger } from './logger';

interface Entry { data: unknown; expiresAt: number }
const memStore = new Map<string, Entry>();

// ── Redis (optional) ──────────────────────────────────────────────────────────
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

let redis: RedisLike | null = null;

if (env.REDIS_URL) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tryLoad = () => { try { return require('ioredis'); } catch { return null; } };
  const Ioredis = tryLoad();
  if (Ioredis) {
    redis = new Ioredis(env.REDIS_URL) as RedisLike;
    logger.info('Cache: Redis connected');
  } else {
    logger.warn('Cache: REDIS_URL set but ioredis is not installed — using in-memory fallback');
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function cacheGet(key: string): Promise<unknown | undefined> {
  if (redis) {
    const raw = await redis.get(key).catch(() => null);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  }
  const entry = memStore.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { memStore.delete(key); return undefined; }
  return entry.data;
}

export async function cacheSet(key: string, data: unknown, ttlMs = 60_000): Promise<void> {
  if (redis) {
    await redis.set(key, JSON.stringify(data), { EX: Math.ceil(ttlMs / 1000) }).catch(() => null);
    return;
  }
  memStore.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export async function cacheDel(key: string): Promise<void> {
  if (redis) { await redis.del(key).catch(() => null); return; }
  memStore.delete(key);
}
