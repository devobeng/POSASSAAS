import rateLimit from 'express-rate-limit';

const errorBody = (message: string) => ({ success: false, message });

/** General rate limiter for all auth routes — 30 requests / 15 minutes. */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: errorBody('Too many requests — please try again later'),
});

/** Tighter limiter for the login endpoint — 10 attempts / 15 minutes. */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: errorBody('Too many login attempts — please try again in 15 minutes'),
  skipSuccessfulRequests: true,
});
