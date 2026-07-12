import { Router, raw } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { requireActiveSubscription } from '../../middleware/subscription';
import * as paymentsController from './payments.controller';

export const paymentsRouter = Router();

// ─── Webhook ──────────────────────────────────────────────────────────────────
// No auth — Paystack signs the request with HMAC-SHA512.
// Raw body parser must run here so the signature can be verified.
paymentsRouter.post(
  '/webhook',
  raw({ type: 'application/json' }),
  paymentsController.handleWebhook,
);

// ─── Authenticated routes ─────────────────────────────────────────────────────
paymentsRouter.use(authenticate);

// Subscription management — exempt from the subscription guard so that an
// inactive store can still navigate here to renew.
paymentsRouter.post(
  '/subscribe',
  authorize('STORE_ADMIN', 'SUPER_ADMIN'),
  paymentsController.subscribe,
);
paymentsRouter.get(
  '/subscription',
  authorize('STORE_ADMIN', 'SUPER_ADMIN'),
  paymentsController.getSubscription,
);

// All routes below are subject to the subscription guard.
// GET requests are passed through by the guard; only POST/PUT/PATCH/DELETE are blocked.
paymentsRouter.use(requireActiveSubscription());

paymentsRouter.post(
  '/initialize',
  authorize('CASHIER', 'BRANCH_MANAGER', 'STORE_ADMIN', 'SUPER_ADMIN'),
  paymentsController.initializePayment,
);

paymentsRouter.get(
  '/verify/:reference',
  authorize('CASHIER', 'BRANCH_MANAGER', 'STORE_ADMIN', 'SUPER_ADMIN'),
  paymentsController.verifyPayment,
);
