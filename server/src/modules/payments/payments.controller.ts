import type { Request, Response } from 'express';
import * as paymentsService from './payments.service';
import * as paystackSvc from '../../services/paystack.service';
import { sendSuccess } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../middleware/error';
import { logger } from '../../utils/logger';
import { initializePaymentSchema, subscribeSchema } from './payments.schema';

// ─── POST /api/v1/payments/initialize ─────────────────────────────────────────

export const initializePayment = asyncHandler(async (req: Request, res: Response) => {
  const { sub: userId, storeId: userStoreId, email } = req.user!;
  if (!email) throw new AppError('User email required for payment initialization', 400);

  const storeId = (req.storeId ?? userStoreId)!;
  const { orderId, callbackUrl } = initializePaymentSchema.parse(req.body);

  const txInit = await paymentsService.initializePayment(orderId, storeId, email, callbackUrl);

  sendSuccess(res, txInit, 'Payment initialized');
});

// ─── POST /api/v1/payments/webhook ────────────────────────────────────────────
// Raw body parser is applied in routes — req.body is a Buffer here.

export const handleWebhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers['x-paystack-signature'] as string | undefined;

  if (!signature) {
    res.status(400).json({ success: false, message: 'Missing signature header' });
    return;
  }

  if (!paystackSvc.verifyWebhookSignature(req.body as Buffer, signature)) {
    res.status(401).json({ success: false, message: 'Invalid signature' });
    return;
  }

  let event: paymentsService.WebhookEvent;
  try {
    const rawStr = (req.body as Buffer).toString('utf-8');
    event = JSON.parse(rawStr) as paymentsService.WebhookEvent;
  } catch (err) {
    logger.error('Failed to parse webhook body', err);
    // Malformed body from a signed Paystack request isn't something a retry
    // fixes — ack so Paystack doesn't hammer us with the same bad payload.
    res.sendStatus(200);
    return;
  }

  // Persist the raw event BEFORE acking — Paystack only retries a delivery
  // that doesn't get a 200, so once we ack, a crash before processing
  // finishes would otherwise lose this event forever. This row is what lets
  // a stuck event be found and replayed after the fact.
  const eventRecord = await paymentsService.recordWebhookEvent(event);

  // Respond 200 immediately — Paystack considers any other status a failure and retries
  res.sendStatus(200);

  // Process async without blocking response
  paymentsService.processWebhookEvent(event, eventRecord.id).catch((err) => {
    logger.error('Webhook processing error', err);
  });
});

// ─── GET /api/v1/payments/verify/:reference ───────────────────────────────────

export const verifyPayment = asyncHandler(async (req: Request, res: Response) => {
  const { sub: userId, storeId: userStoreId } = req.user!;
  const storeId = (req.storeId ?? userStoreId)!;

  const result = await paymentsService.verifyPayment(req.params.reference, storeId, userId);
  sendSuccess(res, result, 'Payment verified');
});

// ─── POST /api/v1/payments/subscribe ─────────────────────────────────────────

export const subscribe = asyncHandler(async (req: Request, res: Response) => {
  const { sub: userId, storeId: userStoreId, email } = req.user!;
  const storeId = (req.storeId ?? userStoreId)!;

  if (!email) throw new AppError('User email required', 400);

  const { planId, callbackUrl } = subscribeSchema.parse(req.body);

  const txInit = await paymentsService.subscribeToPlan(
    storeId,
    userId,
    email,
    planId,
    callbackUrl,
  );

  const message =
    'alreadyActive' in txInit
      ? 'You are already on this plan'
      : txInit.free
        ? 'Free plan activated'
        : 'Subscription initialized — complete payment to activate';

  sendSuccess(res, txInit, message);
});

// ─── GET /api/v1/payments/subscription ────────────────────────────────────────

export const getSubscription = asyncHandler(async (req: Request, res: Response) => {
  const { storeId: userStoreId } = req.user!;
  const storeId = (req.storeId ?? userStoreId)!;

  const data = await paymentsService.getSubscriptionStatus(storeId);
  sendSuccess(res, data);
});
