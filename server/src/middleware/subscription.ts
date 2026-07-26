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

/**
 * Applied per-route (or per-router). Blocks the request entirely — GET
 * included, since most feature-gated endpoints here are read-only reports —
 * unless the store's current plan has `featureName: true` in its `features`
 * JSON. SUPER_ADMIN is always bypassed — they're the platform operator
 * inspecting a store (via ?storeId=), not that store's customer, so its
 * plan's feature limits shouldn't apply to them. A store with no plan
 * attached at all (shouldn't normally happen, but defensively) is treated
 * as having no features.
 */
export function requireFeature(featureName: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (req.user?.role === 'SUPER_ADMIN') return next();

    const storeId = req.user?.storeId;
    if (!storeId) {
      return next(new AppError('User account is not associated with a store', 403));
    }

    try {
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { subscriptionPlan: { select: { features: true } } },
      });

      if (!store) return next(new AppError('Store not found', 404));

      const features = (store.subscriptionPlan?.features ?? {}) as Record<string, unknown>;
      if (features[featureName] !== true) {
        return next(
          new AppError(
            'Upgrade your plan to access this feature.',
            402,
            'FEATURE_LOCKED',
          ),
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
