import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, type JwtPayload } from '../utils/jwt';
import { AppError } from './error';
import type { Role } from '@prisma/client';

// Declare the augmentation here — ts-node only loads files in the import chain,
// not every file matched by tsconfig "include", so the standalone express.d.ts
// was never compiled at runtime. This declaration runs whenever auth.ts is imported.
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      storeId?: string;
    }
  }
}

export type { JwtPayload };

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 401));
  }
  const token = authHeader.split(' ')[1];
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    next(new AppError('Invalid or expired token', 401));
  }
}

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new AppError('Authentication required', 401));
    if (!roles.includes(req.user.role as Role)) {
      return next(new AppError('Insufficient permissions', 403));
    }
    next();
  };
}
