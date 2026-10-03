import cron from 'node-cron';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { auditLog } from '../../utils/audit';
import { mapLimit } from '../../utils/concurrency';
import * as paystack from '../../services/paystack.service';
import { replayStuckWebhookEvents } from './payments.service';
import { invalidateSubscriptionStatusCache } from '../../middleware/subscription';

const RECONCILE_PAGE_SIZE = 200;
const RECONCILE_CONCURRENCY = 5;

/** Flips TRIAL stores whose trialEndsAt has passed to EXPIRED, blocking
 *  writes (via requireActiveSubscription) until they pick/pay for a plan. */
export async function expireOverdueTrials(): Promise<void> {
  const overdue = await prisma.store.findMany({
    where: { subscriptionStatus: 'TRIAL', trialEndsAt: { lte: new Date() } },
    select: { id: true },
  });
  if (overdue.length === 0) return;

  await prisma.store.updateMany({
    where: { id: { in: overdue.map((s) => s.id) } },
    data: { subscriptionStatus: 'EXPIRED' },
  });
  await Promise.all(overdue.map((s) => invalidateSubscriptionStatusCache(s.id)));

  logger.info(`[subscription-cron] Expired ${overdue.length} overdue trial(s)`);
}

/** Compares each subscribed store's local subscriptionStatus against what
 *  Paystack actually thinks that subscription's state is. The suspend/
 *  activate flow in admin.service.ts fails open by design (a Paystack
 *  hiccup must not block an access-control action), which means a failed
 *  disable/enable call there can leave the two sides silently disagreeing —
 *  either a suspended store still being billed, or a reactivated store
 *  getting full access back with billing never actually resumed. Neither
 *  side has any other way to notice that drift, so this is the backstop:
 *  it logs and audits every mismatch it finds rather than fixing it
 *  automatically, since which side is "correct" isn't always obvious from
 *  here (e.g. the store may have cancelled directly through Paystack). */
export async function reconcileSubscriptionBilling(): Promise<void> {
  let mismatches = 0;
  let cursor: string | undefined;

  // Paginated so a platform with hundreds of subscribed stores doesn't load
  // them all into memory at once; bounded concurrency below so the Paystack
  // fetches for one page don't run fully sequentially either.
  for (;;) {
    const stores = await prisma.store.findMany({
      where: { paystackSubscriptionCode: { not: null } },
      select: { id: true, name: true, subscriptionStatus: true, paystackSubscriptionCode: true },
      take: RECONCILE_PAGE_SIZE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      orderBy: { id: 'asc' },
    });
    if (stores.length === 0) break;
    cursor = stores[stores.length - 1].id;

    const pageMismatches = await mapLimit(stores, RECONCILE_CONCURRENCY, async (store) => {
      if (!store.paystackSubscriptionCode) return false;

      // Only ACTIVE and SUSPENDED are states we ourselves deliberately put
      // Paystack's subscription into (via enable/disable), so only those two
      // are meaningful to compare. INACTIVE is Paystack's own transient
      // "a charge failed, retrying" state — its subscription typically stays
      // 'active' on Paystack's side throughout that retry window by design,
      // which isn't drift, just how a failed-then-retrying subscription
      // normally looks for days at a time. Flagging that here would swamp
      // real mismatches in false positives on the single most common
      // real-world case (a temporarily declined card).
      if (store.subscriptionStatus !== 'ACTIVE' && store.subscriptionStatus !== 'SUSPENDED') return false;

      let paystackStatus: string;
      try {
        const sub = await paystack.fetchSubscription(store.paystackSubscriptionCode);
        paystackStatus = sub.status;
      } catch (err) {
        logger.warn(`[billing-reconcile] Could not fetch subscription for store ${store.id}`, err);
        return false;
      }

      const paystackIsActive = paystackStatus === 'active';
      const localIsActive = store.subscriptionStatus === 'ACTIVE';

      if (paystackIsActive !== localIsActive) {
        logger.error(
          `[billing-reconcile] Status mismatch for store ${store.id} (${store.name}): ` +
            `local=${store.subscriptionStatus}, paystack=${paystackStatus}`,
        );
        await auditLog({
          storeId: store.id,
          userId: 'system',
          action: 'BILLING_STATUS_MISMATCH',
          entity: 'Store',
          entityId: store.id,
          metadata: { localStatus: store.subscriptionStatus, paystackStatus },
        });
        return true;
      }
      return false;
    });

    mismatches += pageMismatches.filter(Boolean).length;
    if (stores.length < RECONCILE_PAGE_SIZE) break;
  }

  if (mismatches > 0) {
    logger.error(`[billing-reconcile] Found ${mismatches} local/Paystack status mismatch(es)`);
  }
}

/** Register cron schedule and run catch-up immediately on boot. */
export function startSubscriptionCron(): void {
  expireOverdueTrials().catch((err) =>
    logger.error('[subscription-cron] Catch-up failed', err),
  );
  reconcileSubscriptionBilling().catch((err) =>
    logger.error('[billing-reconcile] Catch-up failed', err),
  );
  replayStuckWebhookEvents().catch((err) =>
    logger.error('[webhook-replay] Catch-up failed', err),
  );

  // Daily at 00:10 — offset from the expenses cron (00:05) to avoid contention
  cron.schedule('10 0 * * *', () => {
    expireOverdueTrials().catch((err) =>
      logger.error('[subscription-cron] Scheduled run failed', err),
    );
  });

  // Daily at 00:15 — offset from the trial-expiry job above
  cron.schedule('15 0 * * *', () => {
    reconcileSubscriptionBilling().catch((err) =>
      logger.error('[billing-reconcile] Scheduled run failed', err),
    );
  });

  // Every 5 minutes — a stuck webhook event is a crashed/failed charge or
  // subscription update sitting unresolved, so this needs a much tighter
  // loop than the daily jobs above rather than waiting up to 24h to recover.
  cron.schedule('*/5 * * * *', () => {
    replayStuckWebhookEvents().catch((err) =>
      logger.error('[webhook-replay] Scheduled run failed', err),
    );
  });

  logger.info('[subscription-cron] Scheduled (daily 00:10 + boot catch-up)');
  logger.info('[billing-reconcile] Scheduled (daily 00:15 + boot catch-up)');
  logger.info('[webhook-replay] Scheduled (every 5 min + boot catch-up)');
}
