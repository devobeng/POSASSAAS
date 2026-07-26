import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate, authorize } from '../../middleware/auth';
import {
  authRateLimiter,
  loginRateLimiter,
  smsOtpRequestRateLimiter,
  smsOtpVerifyRateLimiter,
} from '../../middleware/rateLimiter';
import {
  loginSchema,
  registerStoreSchema,
  forgotPasswordRequestSchema,
  forgotPasswordVerifySchema,
  forgotPasswordResetSchema,
} from './auth.schema';
import * as authController from './auth.controller';

export const authRouter = Router();

authRouter.use(authRateLimiter);

authRouter.post('/register-store', validate(registerStoreSchema), authController.registerStore);
authRouter.post('/login', loginRateLimiter, validate(loginSchema), authController.login);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout', authenticate, authController.logout);
authRouter.get('/me', authenticate, authController.me);

// SMS (Hubtel OTP) password reset — self-service, unauthenticated
authRouter.post(
  '/forgot-password/sms',
  smsOtpRequestRateLimiter,
  validate(forgotPasswordRequestSchema),
  authController.forgotPasswordRequest,
);
authRouter.post(
  '/forgot-password/sms/verify',
  smsOtpVerifyRateLimiter,
  validate(forgotPasswordVerifySchema),
  authController.forgotPasswordVerify,
);
authRouter.post(
  '/forgot-password/sms/reset',
  validate(forgotPasswordResetSchema),
  authController.forgotPasswordReset,
);

// Protected test route used in integration tests to verify RBAC
authRouter.get(
  '/admin-only',
  authenticate,
  authorize('STORE_ADMIN', 'SUPER_ADMIN'),
  (_req, res) => { res.json({ success: true }); },
);
