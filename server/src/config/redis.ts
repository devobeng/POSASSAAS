import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

/** Shared Redis connection — null when REDIS_URL isn't set. Both the cache
 *  layer and the rate limiters fall back to in-process alternatives when
 *  this is null or when a call against it fails, so nothing here should
 *  ever throw or block server startup. */
export const redisClient: Redis | null = env.REDIS_URL
  ? new Redis(env.REDIS_URL, {
      // Every caller (cache.ts, rateLimiter.ts) has an in-memory fallback
      // path and every rate limiter sets passOnStoreError — but all of that
      // only helps if a Redis outage fails FAST. ioredis's defaults
      // (10s connect timeout, unlimited reconnect attempts, offline command
      // queueing) would otherwise make every request wait through most of
      // that before falling through — fine for "wrong answer", not for
      // "answer 10 seconds late". Tuned here so a request-time getReset()
      // check via rate-limit-redis actually fails open in well under a
      // second when Redis is down.
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      enableOfflineQueue: false,
      retryStrategy: () => null, // don't keep trying to reconnect in the background
    })
  : null;

if (redisClient) {
  redisClient.on('connect', () => logger.info('Redis connected'));
  redisClient.on('error', (err) => {
    logger.warn(`Redis connection error — falling back to in-memory where applicable: ${err.message}`);
  });
}
