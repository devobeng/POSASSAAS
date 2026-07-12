import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate, authorize } from '../../middleware/auth';
import { authRateLimiter, loginRateLimiter } from '../../middleware/rateLimiter';
import { loginSchema, registerStoreSchema } from './auth.schema';
import * as authController from './auth.controller';

export const authRouter = Router();

authRouter.use(authRateLimiter);

authRouter.post('/register-store', validate(registerStoreSchema), authController.registerStore);
authRouter.post('/login', loginRateLimiter, validate(loginSchema), authController.login);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout', authenticate, authController.logout);
authRouter.get('/me', authenticate, authController.me);

// Protected test route used in integration tests to verify RBAC
authRouter.get(
  '/admin-only',
  authenticate,
  authorize('STORE_ADMIN', 'SUPER_ADMIN'),
  (_req, res) => { res.json({ success: true }); },
);
