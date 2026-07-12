import type { Request, Response, NextFunction } from 'express';
import { AppError } from './error';

/**
 * Sets req.storeId from the authenticated user's JWT.
 * SUPER_ADMIN gets req.storeId = undefined (platform-wide access).
 * All other roles must have a storeId on their token or receive 403.
 */
export function tenantScope(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new AppError('Authentication required', 401));
  if (req.user.role === 'SUPER_ADMIN') {
    req.storeId = undefined;
    return next();
  }
  if (!req.user.storeId) {
    return next(new AppError('User account is not associated with a store', 403));
  }
  req.storeId = req.user.storeId;
  next();
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
