import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error';
import { auditLog } from '../../utils/audit';
import * as paystack from '../../services/paystack.service';
import { logger } from '../../utils/logger';
import { invalidateSubscriptionStatusCache } from '../../middleware/subscription';

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

export async function verifyPayment(reference: string, storeId: string, userId: string) {
  const tx = await paystack.verifyTransaction(reference);

  const payment = await prisma.payment.findUnique({
    where: { paystackReference: reference },
    include: { order: true },
  });

  // No Payment row — this is a SaaS subscription checkout, not a POS order payment.
  if (!payment) return verifySubscriptionPayment(reference, storeId);

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

    // The webhook path (handleChargeSuccess) audits this same transition —
    // this is the user-triggered fallback for when the webhook is late or
    // never arrives, and it mutates the same financial state, so it needs
    // the same accountability trail.
    void auditLog({
      storeId,
      userId,
      action: 'PAYMENT_SUCCESS',
      entity: 'Payment',
      entityId: payment.id,
      metadata: { reference, orderNumber: payment.order.orderNumber, source: 'manual_verify' },
    });
  }

  return { paystackStatus: tx.status, payment };
}

// ─── Webhook: handle charge.success ──────────────────────────────────────────

async function handleChargeSuccess(data: {
  reference: string;
  metadata?: Record<string, unknown>;
  customer?: { customer_code: string };
}) {
  const { reference, metadata, customer } = data;

  const payment = await prisma.payment.findUnique({
    where: { paystackReference: reference },
    include: { order: { select: { id: true, storeId: true, status: true, orderNumber: true } } },
  });

  if (!payment) {
    // No Payment row — this is SaaS subscription billing, not a POS order
    // payment. Two distinct cases:
    if (metadata?.type === 'subscription' && metadata.storeId && metadata.planId) {
      // The very first checkout — we initialized this transaction ourselves,
      // so our metadata is guaranteed to be there.
      await activateSubscription(metadata.storeId as string, metadata.planId as string);
      return;
    }

    // A recurring renewal Paystack initiated on its own — our metadata
    // likely isn't propagated onto it, so resolve the store by customer_code
    // instead (same fallback the subscription webhooks already use). If a
    // previous failed charge had marked this store INACTIVE, a successful
    // renewal is exactly the signal that should undo that — SUSPENDED stores
    // are deliberately left untouched here; only an admin lifts that one.
    const store = await resolveStoreFromSubscription(metadata, customer?.customer_code);
    if (store) {
      await prisma.store.updateMany({
        where: { id: store.id, subscriptionStatus: 'INACTIVE' },
        data: { subscriptionStatus: 'ACTIVE' },
      });
      await invalidateSubscriptionStatusCache(store.id);
    } else {
      logger.warn(`Webhook charge.success: no Payment with reference ${reference}`);
    }
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
  subscription_code: string;
  email_token: string;
  metadata?: Record<string, unknown>;
}) {
  const store = await resolveStoreFromSubscription(data.metadata, data.customer.customer_code);
  if (!store) return;

  // Capturing these here is what makes disableSubscription/enableSubscription
  // callable at all later (plan switch, downgrade to free, admin suspend) —
  // without them there is no way to stop this subscription from recurring.
  // SUSPENDED is an admin-only lock — subscribeToPlan already refuses to let
  // a suspended store create a new subscription in the first place, so this
  // guard is a defense-in-depth backstop against a late/out-of-order webhook
  // silently reactivating one anyway.
  const result = await prisma.store.updateMany({
    where: { id: store.id, subscriptionStatus: { not: 'SUSPENDED' } },
    data: {
      subscriptionStatus: 'ACTIVE',
      paystackSubscriptionCode: data.subscription_code,
      paystackEmailToken: data.email_token,
    },
  });
  await invalidateSubscriptionStatusCache(store.id);
  if (result.count === 0) {
    logger.warn(`[webhook] subscription.create ignored for store ${store.id} — currently SUSPENDED`);
  }
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

  // SUSPENDED is an admin-only lock — a failed charge on an already-suspended
  // store's (still technically live, e.g. if the disable call itself failed)
  // subscription must not relabel that as a billing problem and mask the
  // deliberate suspension.
  await prisma.store.updateMany({
    where: { id: store.id, subscriptionStatus: { not: 'SUSPENDED' } },
    data: { subscriptionStatus: 'INACTIVE' },
  });
  await invalidateSubscriptionStatusCache(store.id);
}

async function handleSubscriptionDisable(data: {
  customer: { customer_code: string };
  metadata?: Record<string, unknown>;
}) {
  const store = await resolveStoreFromSubscription(data.metadata, data.customer.customer_code);
  if (!store) return;

  // Clear the pointer along with the status — Paystack has already
  // cancelled this subscription itself (retries exhausted), so it's dead on
  // both sides now. Leaving it in place would make the next subscribeToPlan
  // call try to disable an already-dead subscription via
  // cancelExistingSubscription (default throwOnFailure: true), which could
  // block this store from ever resubscribing if that call errors.
  //
  // Critically, this must NOT run for a SUSPENDED store: admin.service.ts's
  // suspend flow calls disableSubscription itself and deliberately KEEPS the
  // code/token around so a later "activate" can re-enable the very same
  // subscription. If that same API call also fires this webhook (which
  // webhooks typically do, regardless of what triggered the state change),
  // this handler would otherwise silently relabel the admin's SUSPENDED as
  // CANCELLED and wipe the exact reference reactivation depends on — leaving
  // the store's subscription unrecoverable and any later "activate" giving
  // back full paid access with nothing left to actually bill.
  const result = await prisma.store.updateMany({
    where: { id: store.id, subscriptionStatus: { not: 'SUSPENDED' } },
    data: {
      subscriptionStatus: 'CANCELLED',
      paystackSubscriptionCode: null,
      paystackEmailToken: null,
    },
  });
  await invalidateSubscriptionStatusCache(store.id);
  if (result.count === 0) {
    logger.warn(`[webhook] subscription.disable ignored for store ${store.id} — currently SUSPENDED`);
  }
}

// ─── Main webhook dispatcher ──────────────────────────────────────────────────

export interface WebhookEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Best-effort extraction of a reference to key the WebhookEvent row on —
 *  purely for lookup/debugging convenience, never relied on for correctness. */
function extractReference(event: WebhookEvent): string | undefined {
  const data = event.data as { reference?: string; subscription_code?: string };
  return data.reference ?? data.subscription_code;
}

/** Durably persists the raw event BEFORE it's acked to Paystack. Must be
 *  awaited by the caller prior to responding 200 — see handleWebhook. */
export async function recordWebhookEvent(event: WebhookEvent) {
  return prisma.webhookEvent.create({
    data: {
      eventType: event.event,
      reference: extractReference(event),
      payload: event as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function processWebhookEvent(event: WebhookEvent, eventRecordId?: string): Promise<void> {
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

    if (eventRecordId) {
      await prisma.webhookEvent.update({
        where: { id: eventRecordId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
    }
  } catch (err) {
    logger.error(`Error processing webhook event ${event.event}`, err);
    // Do NOT re-throw — we've already sent 200 to Paystack. But a failure
    // here can mean a customer's card was successfully charged and their
    // subscription still never got activated (e.g. a foreign-key violation
    // if the plan they paid for was deleted mid-checkout) — the server log
    // line above is easy to miss, so also leave a queryable trail.
    const message = err instanceof Error ? err.message : String(err);
    void auditLog({
      userId: 'system',
      action: 'WEBHOOK_PROCESSING_FAILED',
      entity: 'PaystackEvent',
      entityId: event.event,
      metadata: { event: event.event, error: message },
    }).catch(() => {});

    if (eventRecordId) {
      await prisma.webhookEvent.update({
        where: { id: eventRecordId },
        data: { status: 'FAILED', error: message.slice(0, 1000), processedAt: new Date() },
      }).catch(() => {});
    }
  }
}

/** Finds webhook deliveries that were persisted but never finished processing
 *  — e.g. the process crashed or was redeployed between recordWebhookEvent
 *  and processWebhookEvent completing — and replays them. Paystack itself
 *  never retries these since it already got a 200, so without this sweep
 *  they'd be lost forever. Also retries anything that FAILED, since most
 *  failures here are transient (a DB hiccup, a momentary FK race). */
export async function replayStuckWebhookEvents(olderThanMs = 2 * 60 * 1000): Promise<number> {
  const stuck = await prisma.webhookEvent.findMany({
    where: {
      status: { in: ['RECEIVED', 'FAILED'] },
      receivedAt: { lte: new Date(Date.now() - olderThanMs) },
    },
    orderBy: { receivedAt: 'asc' },
    take: 50,
  });

  for (const record of stuck) {
    const event = record.payload as unknown as WebhookEvent;
    await processWebhookEvent(event, record.id);
  }

  if (stuck.length > 0) {
    logger.info(`[webhook-replay] Reprocessed ${stuck.length} stuck webhook event(s)`);
  }
  return stuck.length;
}

// ─── SaaS subscription flow ───────────────────────────────────────────────────

/** Activates a plan on a store directly — used for the Free plan (no payment)
 *  and by the paid-plan verify/webhook paths once Paystack confirms payment.
 *
 *  SUSPENDED is an admin-only lock, guarded here rather than in each caller:
 *  subscribeToPlan already refuses a suspended store before ever reaching
 *  this point, but handleChargeSuccess's first-checkout branch and
 *  verifySubscriptionPayment both call this directly with no guard of their
 *  own. Without it, a checkout that was already open before an admin
 *  suspended the store — then completed by the customer moments after —
 *  would silently reactivate it the instant that charge is confirmed. */
async function activateSubscription(
  storeId: string,
  planId: string,
  opts?: { clearPaystackSubscription?: boolean },
): Promise<void> {
  const result = await prisma.store.updateMany({
    where: { id: storeId, subscriptionStatus: { not: 'SUSPENDED' } },
    data: {
      subscriptionPlanId: planId,
      subscriptionStatus: 'ACTIVE',
      trialEndsAt: null,
      ...(opts?.clearPaystackSubscription && {
        paystackSubscriptionCode: null,
        paystackEmailToken: null,
      }),
    },
  });
  await invalidateSubscriptionStatusCache(storeId);
  if (result.count === 0) {
    logger.warn(`[billing] activateSubscription ignored for store ${storeId} — currently SUSPENDED`);
  }
}

/** Cancels a store's current Paystack subscription — called whenever a store
 *  is about to leave its current plan (switch to a different paid plan, or
 *  downgrade to free), so Paystack stops recurring the OLD plan's charge.
 *
 *  Failure handling differs by caller, and that difference matters:
 *   - Switching to a DIFFERENT PAID plan (throwOnFailure: true, the default)
 *     must fail CLOSED — if we can't confirm the old subscription is gone,
 *     we must not create a new one on top of it, or the customer ends up
 *     billed for both. Blocking the switch here is harmless: they just stay
 *     on their current, still-fine plan and can retry.
 *   - Downgrading to FREE (throwOnFailure: false) must NOT be blocked by
 *     this at all — activateSubscription's free path never talks to
 *     Paystack, so there's no double-billing risk to guard against here,
 *     only "did the old recurring charge actually stop." A customer trying
 *     to stop paying should never be trapped in a paid plan by a transient
 *     Paystack error; that's a follow-up/ops concern (surfaced via the error
 *     log below), not a reason to refuse the downgrade itself. */
// Returns whether the old subscription is confirmed gone (nothing to cancel,
// or the cancel call succeeded) — false only when throwOnFailure is disabled
// and the cancel call failed. Callers use this to decide whether it's safe
// to also clear the local subscription-code pointer.
async function cancelExistingSubscription(
  storeId: string,
  code?: string | null,
  token?: string | null,
  opts?: { throwOnFailure?: boolean },
): Promise<boolean> {
  if (!code || !token) return true;
  const throwOnFailure = opts?.throwOnFailure ?? true;

  try {
    await paystack.disableSubscription({ code, token });
  } catch (err) {
    logger.error(
      `Failed to disable previous Paystack subscription for store ${storeId} — ` +
        (throwOnFailure
          ? 'refusing to switch plans until this succeeds'
          : 'proceeding with the downgrade anyway; this needs manual follow-up to stop the old charge'),
      err,
    );
    if (throwOnFailure) {
      throw new AppError(
        'Unable to update your subscription right now — please try again shortly.',
        503,
      );
    }
    return false; // best-effort: caller must NOT clear the local pointer — it's still needed for follow-up
  }

  await prisma.store.update({
    where: { id: storeId },
    data: { paystackSubscriptionCode: null, paystackEmailToken: null },
  });
  return true;
}

export async function subscribeToPlan(
  storeId: string,
  userId: string,
  storeAdminEmail: string,
  planId: string,
  callbackUrl?: string,
) {
  const [store, plan, adminUser] = await Promise.all([
    prisma.store.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        subscriptionPlanId: true,
        subscriptionStatus: true,
        paystackCustomerCode: true,
        paystackSubscriptionCode: true,
        paystackEmailToken: true,
      },
    }),
    prisma.subscriptionPlan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        price: true,
        name: true,
        maxBranches: true,
        maxUsers: true,
        paystackPlanCode: true,
        paystackPlanAmount: true,
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);

  if (!store) throw new AppError('Store not found', 404);
  if (!plan) throw new AppError('Plan not found', 404);

  // A platform-suspended store must not be able to reactivate itself by
  // just picking a (even free) plan — that would undermine the SUPER_ADMIN
  // suspension entirely. Only a SUPER_ADMIN activating the store again lifts this.
  if (store.subscriptionStatus === 'SUSPENDED') {
    throw new AppError('Your store has been suspended. Contact support to reactivate.', 403);
  }

  // Already active on this exact plan — a no-op, not a switch. Cancelling
  // and recreating an identical subscription here would tear down a
  // perfectly good one for no reason, and leave the store with nothing if
  // the "new" checkout that follows is abandoned. This is the realistic
  // path for a double-submit, browser-back resubmit, or a stale page that
  // hasn't refreshed its "current plan" state yet.
  if (store.subscriptionStatus === 'ACTIVE' && store.subscriptionPlanId === planId) {
    return { free: Number(plan.price) === 0, alreadyActive: true as const };
  }

  // A switch (including a downgrade to Free) must not silently leave the
  // store over the TARGET plan's limits — branches.service.ts/users.service.ts
  // only ever enforce a limit at create-time against whatever plan is
  // *currently* active, so a downgrade is the one path with no create/create
  // moment to catch this otherwise.
  const [activeBranches, activeUsers] = await Promise.all([
    prisma.branch.count({ where: { storeId, isActive: true } }),
    prisma.user.count({ where: { storeId, isActive: true } }),
  ]);
  if (activeBranches > plan.maxBranches || activeUsers > plan.maxUsers) {
    throw new AppError(
      `This plan allows up to ${plan.maxBranches} branch(es) and ${plan.maxUsers} user(s), ` +
        `but your store currently has ${activeBranches} active branch(es) and ${activeUsers} ` +
        `active user(s). Deactivate some first, or choose a higher plan.`,
      409,
    );
  }

  // Free plan — always let the downgrade go through locally; best-effort
  // cancel the old Paystack subscription, but never block on it (see
  // cancelExistingSubscription's doc comment for why this differs from the
  // paid-plan-switch path below).
  if (Number(plan.price) === 0) {
    const cancelled = await cancelExistingSubscription(
      storeId,
      store.paystackSubscriptionCode,
      store.paystackEmailToken,
      { throwOnFailure: false },
    );
    // Only clear the pointer if we actually confirmed cancellation — on
    // failure it must survive so the still-possibly-live subscription isn't
    // lost track of.
    await activateSubscription(storeId, planId, { clearPaystackSubscription: cancelled });
    return { free: true as const };
  }

  // Switching plans (or retrying) — cancel whatever subscription is
  // currently live before establishing the new one below.
  await cancelExistingSubscription(storeId, store.paystackSubscriptionCode, store.paystackEmailToken);

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

  const amountInSmallestUnit = Math.round(Number(plan.price) * 100);

  // Lazily create the recurring Paystack Plan on first-ever paid subscribe —
  // plans are seeded/created locally before they ever have a Paystack
  // counterpart. Also recreate it whenever the local price has drifted from
  // whatever amount the cached Plan was created with: Paystack Plans are
  // treated as immutable here, so a price edit means a NEW Plan object for
  // new subscribers going forward, not silently repricing whoever is
  // already tied to the old one (and not silently keeping everyone on the
  // stale price forever, which is what reusing the cached code unconditionally
  // would do).
  const staleCode = plan.paystackPlanCode;
  let planCode = staleCode;
  if (!planCode || plan.paystackPlanAmount !== amountInSmallestUnit) {
    const paystackPlan = await paystack.createPlan({
      name: plan.name,
      amount: amountInSmallestUnit,
      interval: 'monthly',
    });
    planCode = paystackPlan.plan_code;

    // Optimistic concurrency: two concurrent first-time subscribers to this
    // exact plan would otherwise both create a Paystack Plan and race to
    // persist it, silently orphaning whichever one loses. Only write if the
    // row still has the exact value we read; if another request already won,
    // defer to whatever it persisted instead of our own now-orphaned plan.
    const result = await prisma.subscriptionPlan.updateMany({
      where: { id: planId, paystackPlanCode: staleCode },
      data: { paystackPlanCode: planCode, paystackPlanAmount: amountInSmallestUnit },
    });

    if (result.count === 0) {
      const fresh = await prisma.subscriptionPlan.findUnique({
        where: { id: planId },
        select: { paystackPlanCode: true },
      });
      if (fresh?.paystackPlanCode) planCode = fresh.paystackPlanCode;
    }
  }

  // Linking `plan` here makes this a subscription checkout — Paystack
  // charges this transaction now AND creates the recurring Subscription
  // itself off the resulting card authorization, so it re-bills on its own
  // schedule from here on. That's what actually makes renewal happen; the
  // existing subscription.create / invoice.payment_failed / subscription.disable
  // webhook handlers below react to the events it fires from then on.
  const txInit = await paystack.initializeTransaction({
    email: storeAdminEmail,
    amount: amountInSmallestUnit,
    callback_url: callbackUrl,
    metadata: { storeId, planId, type: 'subscription' },
    plan: planCode,
  });

  return { free: false as const, ...txInit };
}

/** Verifies a subscription-checkout reference (no Payment/Order row exists
 *  for these — they're tracked purely via Paystack transaction metadata). */
async function verifySubscriptionPayment(reference: string, storeId: string) {
  const tx = await paystack.verifyTransaction(reference);

  if (tx.metadata?.storeId !== storeId) {
    throw new AppError('Payment not found', 404);
  }

  if (tx.status === 'success') {
    const planId = tx.metadata.planId as string;
    await activateSubscription(storeId, planId);
  }

  return { paystackStatus: tx.status };
}

export async function getSubscriptionStatus(storeId: string) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      subscriptionStatus: true,
      trialEndsAt: true,
      subscriptionPlan: {
        select: { id: true, name: true, price: true, maxBranches: true, maxUsers: true, features: true },
      },
    },
  });

  if (!store) throw new AppError('Store not found', 404);
  return store;
}
