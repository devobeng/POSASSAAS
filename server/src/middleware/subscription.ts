import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from './error';

const BLOCKED_STATUSES = ['INACTIVE', 'EXPIRED', 'CANCELLED'] as const;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Applied per-router. Blocks write operations when a store's subscription
 * is not in good standing. Read-only requests always pass through.
 * SUPER_ADMIN (no storeId on JWT) is always bypassed.
 */
export function requireActiveSubscription() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!WRITE_METHODS.has(req.method)) return next();

    const storeId = req.storeId ?? req.user?.storeId;
    if (!storeId) return next(); // SUPER_ADMIN — no storeId

    try {
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { subscriptionStatus: true },
      });

      if (!store) return next(new AppError('Store not found', 404));

      if (BLOCKED_STATUSES.includes(store.subscriptionStatus as typeof BLOCKED_STATUSES[number])) {
        return next(
          new AppError(
            'Your subscription is inactive. Please renew to continue.',
            402,
            'SUBSCRIPTION_INACTIVE',
          ),
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
