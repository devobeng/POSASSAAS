import type { Request, Response, NextFunction } from 'express';
import { AppError } from './error';

/**
 * Resolves which store a request is scoped to. For every role except
 * SUPER_ADMIN this is just their JWT's storeId. SUPER_ADMIN has no store
 * of their own — Prisma silently drops a `storeId: undefined` filter,
 * which previously meant "no filter" (cross-tenant data merged together)
 * rather than "no access". They must now pass ?storeId= explicitly to
 * view one store's operational data; omitting it is a 400, never a
 * platform-wide merge.
 */
export function resolveStoreIdForRequest(req: Request): string {
  if (!req.user) throw new AppError('Authentication required', 401);

  if (req.user.role !== 'SUPER_ADMIN') {
    if (!req.user.storeId) {
      throw new AppError('User account is not associated with a store', 403);
    }
    return req.user.storeId;
  }

  const queryStoreId = req.query.storeId;
  if (typeof queryStoreId !== 'string' || !queryStoreId.trim()) {
    throw new AppError(
      'storeId query parameter is required for platform admin access to store-scoped data',
      400,
    );
  }
  return queryStoreId;
}

/** Sets req.storeId via resolveStoreIdForRequest — see that function for the rules. */
export function tenantScope(req: Request, _res: Response, next: NextFunction): void {
  try {
    req.storeId = resolveStoreIdForRequest(req);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Ensures BRANCH_MANAGER and CASHIER have a branchId on their token.
 * Higher roles pass through — they control scope themselves via query params.
 * Use after `authenticate` and `tenantScope`.
 */
export function branchScope(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new AppError('Authentication required', 401));
  const restricted = ['BRANCH_MANAGER', 'CASHIER'];
  if (restricted.includes(req.user.role) && !req.user.branchId) {
    return next(new AppError('User account is not assigned to a branch', 403));
  }
  next();
}
