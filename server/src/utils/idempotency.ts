/** In-memory idempotency store for order creation.
 *  Key: "{userId}:{idempotency-key-header}"
 *  Swap the Map for a Redis SET NX in production for multi-process safety.
 */

const TTL_MS = 24 * 60 * 60 * 1_000; // 24 h

interface Entry {
  data: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();

function cacheKey(userId: string, key: string): string {
  return `${userId}:${key}`;
}

export function getIdempotentResult(userId: string, key: string): unknown | undefined {
  const entry = store.get(cacheKey(userId, key));
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(cacheKey(userId, key));
    return undefined;
  }
  return entry.data;
}

export function setIdempotentResult(userId: string, key: string, data: unknown): void {
  store.set(cacheKey(userId, key), { data, expiresAt: Date.now() + TTL_MS });
}
