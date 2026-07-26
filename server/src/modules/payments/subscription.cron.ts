import cron from 'node-cron';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';

/** Flips TRIAL stores whose trialEndsAt has passed to EXPIRED, blocking
 *  writes (via requireActiveSubscription) until they pick/pay for a plan. */
export async function expireOverdueTrials(): Promise<void> {
  const result = await prisma.store.updateMany({
    where: { subscriptionStatus: 'TRIAL', trialEndsAt: { lte: new Date() } },
    data: { subscriptionStatus: 'EXPIRED' },
  });

  if (result.count > 0) {
    logger.info(`[subscription-cron] Expired ${result.count} overdue trial(s)`);
  }
}

/** Register cron schedule and run catch-up immediately on boot. */
export function startSubscriptionCron(): void {
  expireOverdueTrials().catch((err) =>
    logger.error('[subscription-cron] Catch-up failed', err),
  );

  // Daily at 00:10 — offset from the expenses cron (00:05) to avoid contention
  cron.schedule('10 0 * * *', () => {
    expireOverdueTrials().catch((err) =>
      logger.error('[subscription-cron] Scheduled run failed', err),
    );
  });

  logger.info('[subscription-cron] Scheduled (daily 00:10 + boot catch-up)');
}
