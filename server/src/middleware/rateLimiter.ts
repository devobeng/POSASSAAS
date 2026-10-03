import rateLimit from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { redisClient } from '../config/redis';

const errorBody = (message: string) => ({ success: false, message });

// In-memory limiter state (express-rate-limit's default store) doesn't
// survive more than one server process — every instance counts requests
// independently, so a limit meant to be "N per window" becomes "N per
// window per instance," silently multiplying the real allowance the moment
// this runs behind a load balancer (the default on most PaaS platforms at
// any real scale). When Redis is configured, share counters through it
// instead so the limit means what it says across every instance; falls
// back to the in-memory store automatically when it isn't. Every limiter
// below also sets passOnStoreError: true — a Redis outage must degrade the
// rate limit (fail open), not the request it's guarding; without it, Redis
// being unreachable would 500 every rate-limited route, including login
// and, via the global limiter, all of /api.
export function sharedStore(prefix: string) {
  const client = redisClient;
  if (!client) return undefined;
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) =>
      client.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
  });
}

/** General rate limiter for all auth routes — 30 requests / 15 minutes. */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true, // see sharedStore() above — Redis errors must not block the request
  message: errorBody('Too many requests — please try again later'),
  store: sharedStore('rl:auth:'),
});

/** Tighter limiter for the login endpoint — 10 attempts / 15 minutes. */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true, // see sharedStore() above — Redis errors must not block the request
  message: errorBody('Too many login attempts — please try again in 15 minutes'),
  skipSuccessfulRequests: true,
  store: sharedStore('rl:login:'),
});

/** Guards the SMS OTP send step — each SMS costs money, so this is tighter
 *  than the general auth limiter (5 requests / 15 minutes per IP). Kept
 *  separate from the verify limiter so burning this quota can't lock a
 *  user out of verifying a code they already received. */
export const smsOtpRequestRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true, // see sharedStore() above — Redis errors must not block the request
  message: errorBody('Too many requests — please try again in 15 minutes'),
  store: sharedStore('rl:otp-req:'),
});

/** Guards OTP verification attempts — separate quota from the send step. */
export const smsOtpVerifyRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true, // see sharedStore() above — Redis errors must not block the request
  message: errorBody('Too many attempts — please try again in 15 minutes'),
  store: sharedStore('rl:otp-verify:'),
});
