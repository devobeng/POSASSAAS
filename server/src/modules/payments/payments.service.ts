import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error';
import { auditLog } from '../../utils/audit';
import * as paystack from '../../services/paystack.service';
import { logger } from '../../utils/logger';

// ─── Initialize payment ───────────────────────────────────────────────────────
// Called by the frontend after order creation to get a Paystack authorization URL
// for the PAYSTACK payment method line on the order.

export async function initializePayment(
  orderId: string,
  storeId: string,
  cashierEmail: string,
  callbackUrl?: string,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: true },
  });

  if (!order) throw new AppError('Order not found', 404);
  if (order.storeId !== storeId) throw new AppError('Order not found', 404);

  const paystackPayment = order.payments.find(
    (p) => p.method === 'PAYSTACK' && p.status === 'PENDING',
  );
  if (!paystackPayment) {
    throw new AppError('No pending Paystack payment found for this order', 400);
  }

  // Amount in smallest currency unit (multiply by 100: GHS → pesewas, NGN → kobo)
  const amountInSmallestUnit = Math.round(Number(paystackPayment.amount) * 100);

  const txInit = await paystack.initializeTransaction({
    email: cashierEmail,
    amount: amountInSmallestUnit,
    callback_url: callbackUrl,
    metadata: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      storeId: order.storeId,
      branchId: order.branchId,
      paymentId: paystackPayment.id,
    },
  });

  // Persist the reference so the webhook can look it up
  await prisma.payment.update({
    where: { id: paystackPayment.id },
    data: { paystackReference: txInit.reference },
  });

  return txInit;
}

// ─── Manual verify ────────────────────────────────────────────────────────────

export async function verifyPayment(reference: string, storeId: string) {
  const tx = await paystack.verifyTransaction(reference);

  const payment = await prisma.payment.findUnique({
    where: { paystackReference: reference },
    include: { order: true },
  });

  if (!payment) throw new AppError('Payment record not found', 404);
  if (payment.order.storeId !== storeId) throw new AppError('Payment not found', 404);

  if (tx.status === 'success' && payment.status !== 'SUCCESS') {
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCESS' },
      }),
      prisma.order.update({
        where: { id: payment.orderId },
        data: { status: 'COMPLETED' },
      }),
    ]);
  }

  return { paystackStatus: tx.status, payment };
}

// ─── Webhook: handle charge.success ──────────────────────────────────────────

async function handleChargeSuccess(data: {
  reference: string;
  metadata?: Record<string, unknown>;
}) {
  const { reference } = data;

  const payment = await prisma.payment.findUnique({
    where: { paystackReference: reference },
    include: { order: { select: { id: true, storeId: true, status: true, orderNumber: true } } },
  });

  if (!payment) {
    logger.warn(`Webhook charge.success: no Payment with reference ${reference}`);
    return;
  }

  // Idempotent — skip if already processed
  if (payment.status === 'SUCCESS') return;

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'SUCCESS' },
    }),
    prisma.order.update({
      where: { id: payment.orderId },
      data: { status: 'COMPLETED' },
    }),
  ]);

  // fire-and-forget audit
  void auditLog({
    storeId: payment.order.storeId,
    userId: payment.id, // no user on a webhook; use payment id as proxy
    action: 'PAYMENT_SUCCESS',
    entity: 'Payment',
    entityId: payment.id,
    metadata: { reference, orderNumber: payment.order.orderNumber },
  });
}

// ─── Webhook: subscription events ─────────────────────────────────────────────

async function resolveStoreFromSubscription(
  metadata: Record<string, unknown> | undefined,
  customerCode?: string,
) {
  // If metadata carries storeId (we inject it when creating subscription)
  if (metadata?.storeId) {
    return prisma.store.findUnique({ where: { id: metadata.storeId as string }, select: { id: true } });
  }
  // Fallback: look up by paystackCustomerCode
  if (customerCode) {
    return prisma.store.findFirst({
      where: { paystackCustomerCode: customerCode },
      select: { id: true },
    });
  }
  return null;
}

async function handleSubscriptionCreate(data: {
  customer: { customer_code: string };
  metadata?: Record<string, unknown>;
}) {
  const store = await resolveStoreFromSubscription(data.metadata, data.customer.customer_code);
  if (!store) return;

  await prisma.store.update({
    where: { id: store.id },
    data: { subscriptionStatus: 'ACTIVE' },
  });
}

async function handleInvoicePaymentFailed(data: {
  subscription: { customer: { customer_code: string } };
  metadata?: Record<string, unknown>;
}) {
  const store = await resolveStoreFromSubscription(
    data.metadata,
    data.subscription?.customer?.customer_code,
  );
  if (!store) return;

  await prisma.store.update({
    where: { id: store.id },
    data: { subscriptionStatus: 'INACTIVE' },
  });
}

async function handleSubscriptionDisable(data: {
  customer: { customer_code: string };
  metadata?: Record<string, unknown>;
}) {
  const store = await resolveStoreFromSubscription(data.metadata, data.customer.customer_code);
  if (!store) return;

  await prisma.store.update({
    where: { id: store.id },
    data: { subscriptionStatus: 'CANCELLED' },
  });
}

// ─── Main webhook dispatcher ──────────────────────────────────────────────────

export interface WebhookEvent {
  event: string;
  data: Record<string, unknown>;
}

export async function processWebhookEvent(event: WebhookEvent): Promise<void> {
  // Always audit the raw event
  void auditLog({
    userId: 'system',
    action: 'WEBHOOK',
    entity: 'PaystackEvent',
    entityId: event.event,
    metadata: { event: event.event },
  }).catch(() => {}); // Suppress — audit failure must never kill the handler

  try {
    switch (event.event) {
      case 'charge.success':
        await handleChargeSuccess(event.data as Parameters<typeof handleChargeSuccess>[0]);
        break;

      case 'subscription.create':
        await handleSubscriptionCreate(
          event.data as Parameters<typeof handleSubscriptionCreate>[0],
        );
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(
          event.data as Parameters<typeof handleInvoicePaymentFailed>[0],
        );
        break;

      case 'subscription.disable':
        await handleSubscriptionDisable(
          event.data as Parameters<typeof handleSubscriptionDisable>[0],
        );
        break;

      default:
        logger.info(`Unhandled Paystack event: ${event.event}`);
    }
  } catch (err) {
    logger.error(`Error processing webhook event ${event.event}`, err);
    // Do NOT re-throw — we've already sent 200 to Paystack
  }
}

// ─── SaaS subscription flow ───────────────────────────────────────────────────

export async function subscribeToPlan(
  storeId: string,
  userId: string,
  storeAdminEmail: string,
  planId: string,
  callbackUrl?: string,
) {
  const [store, plan, adminUser] = await Promise.all([
    prisma.store.findUnique({ where: { id: storeId }, select: { id: true, paystackCustomerCode: true } }),
    prisma.subscriptionPlan.findUnique({
      where: { id: planId },
      select: { id: true, price: true, name: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);

  if (!store) throw new AppError('Store not found', 404);
  if (!plan) throw new AppError('Plan not found', 404);

  // Ensure a Paystack customer exists for this store
  let customerCode = store.paystackCustomerCode;
  if (!customerCode) {
    const fullName = adminUser?.name ?? '';
    const [first, ...rest] = fullName.split(' ');
    const customer = await paystack.createCustomer({
      email: storeAdminEmail,
      first_name: first || undefined,
      last_name: rest.join(' ') || undefined,
    });
    customerCode = customer.customer_code;
    await prisma.store.update({
      where: { id: storeId },
      data: { paystackCustomerCode: customerCode },
    });
  }

  // For subscription billing, initialize a transaction (customer will authorize card)
  const amountInSmallestUnit = Math.round(Number(plan.price) * 100);
  const txInit = await paystack.initializeTransaction({
    email: storeAdminEmail,
    amount: amountInSmallestUnit,
    callback_url: callbackUrl,
    metadata: { storeId, planId, type: 'subscription' },
  });

  return txInit;
}

export async function getSubscriptionStatus(storeId: string) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      subscriptionStatus: true,
      subscriptionPlan: {
        select: { name: true, price: true, maxBranches: true, maxUsers: true, features: true },
      },
    },
  });

  if (!store) throw new AppError('Store not found', 404);
  return store;
}
