import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error';
import { auditLog } from '../../utils/audit';
import * as paystack from '../../services/paystack.service';
import { logger } from '../../utils/logger';
import { invalidateSubscriptionStatusCache } from '../../middleware/subscription';
import type { SubscriptionPlanInput, GetStoresQuery } from './admin.schema';

export async function getStores(query: GetStoresQuery) {
  const { page, limit, search, status } = query;
  const skip = (page - 1) * limit;

  const where = {
    ...(status ? { subscriptionStatus: status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { slug: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [stores, total] = await Promise.all([
    prisma.store.findMany({
      where,
      select: {
        id: true, name: true, slug: true, currency: true,
        subscriptionStatus: true, createdAt: true,
        subscriptionPlan: { select: { name: true, price: true } },
        _count: {
          select: {
            branches: { where: { isActive: true } },
            users: { where: { isActive: true } },
          },
        },
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.store.count({ where }),
  ]);

  return { stores, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
}

export async function setStoreStatus(
  storeId: string,
  status: 'ACTIVE' | 'SUSPENDED',
  actorId: string,
) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, paystackSubscriptionCode: true, paystackEmailToken: true },
  });
  if (!store) throw new AppError('Store not found', 404);

  const updated = await prisma.store.update({
    where: { id: storeId },
    data: { subscriptionStatus: status },
    select: { id: true, name: true, subscriptionStatus: true },
  });
  // Must happen immediately, not on the cache's own TTL — this is the exact
  // path a SUPER_ADMIN uses to lock a store out; a stale cached ACTIVE would
  // let it keep writing for up to STATUS_CACHE_TTL_MS after this call returns.
  await invalidateSubscriptionStatusCache(storeId);

  // Suspending/activating a store should also pause/resume its actual
  // Paystack billing — otherwise a "suspended" store keeps getting charged
  // every cycle even though it's locked out of the product. Best-effort:
  // a Paystack hiccup here must not block the suspend/activate action itself.
  // But it must NOT be silent either — on ACTIVATE specifically, a failure
  // here means the store just got full access back with billing never
  // actually resumed (pure revenue leakage), and the only prior trace was a
  // server log line nobody was watching. billingSyncFailed surfaces that to
  // the caller so the admin UI can warn instead of showing a clean success.
  const { paystackSubscriptionCode: code, paystackEmailToken: token } = store;
  let billingSyncFailed = false;
  if (code && token) {
    try {
      if (status === 'SUSPENDED') {
        await paystack.disableSubscription({ code, token });
      } else {
        await paystack.enableSubscription({ code, token });
      }
    } catch (err) {
      logger.error(
        `Failed to ${status === 'SUSPENDED' ? 'disable' : 'enable'} Paystack subscription for store ${storeId}`,
        err,
      );
      billingSyncFailed = true;
    }
  }

  await auditLog({
    userId: actorId,
    action: status === 'ACTIVE' ? 'ACTIVATE_STORE' : 'SUSPEND_STORE',
    entity: 'Store',
    entityId: storeId,
    ...(billingSyncFailed && { metadata: { billingSyncFailed: true } }),
  });

  return { ...updated, billingSyncFailed };
}

export async function getPlatformStats() {
  const [totalStores, activeStores, totalUsers, gmvResult, totalOrders] = await Promise.all([
    prisma.store.count(),
    prisma.store.count({ where: { subscriptionStatus: 'ACTIVE' } }),
    prisma.user.count({ where: { isActive: true } }),
    prisma.order.aggregate({
      _sum: { grandTotal: true },
      where: { status: 'COMPLETED' },
    }),
    prisma.order.count({ where: { status: 'COMPLETED' } }),
  ]);

  return {
    totalStores,
    activeStores,
    totalUsers,
    totalOrders,
    gmv: Number(gmvResult._sum.grandTotal ?? 0),
  };
}

export async function getSubscriptionPlans() {
  return prisma.subscriptionPlan.findMany({
    orderBy: { price: 'asc' },
    include: { _count: { select: { stores: true } } },
  });
}

export async function createSubscriptionPlan(data: SubscriptionPlanInput, actorId: string) {
  const plan = await prisma.subscriptionPlan.create({ data });
  await auditLog({
    userId: actorId,
    action: 'CREATE',
    entity: 'SubscriptionPlan',
    entityId: plan.id,
    metadata: { name: plan.name },
  });
  return plan;
}

export async function updateSubscriptionPlan(
  planId: string,
  data: Partial<SubscriptionPlanInput>,
  actorId: string,
) {
  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id: planId },
    select: { id: true },
  });
  if (!plan) throw new AppError('Plan not found', 404);

  const updated = await prisma.subscriptionPlan.update({ where: { id: planId }, data });
  await auditLog({
    userId: actorId,
    action: 'UPDATE',
    entity: 'SubscriptionPlan',
    entityId: planId,
    metadata: { fields: Object.keys(data) },
  });
  return updated;
}

export async function deleteSubscriptionPlan(planId: string, actorId: string) {
  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id: planId },
    include: { _count: { select: { stores: true } } },
  });
  if (!plan) throw new AppError('Plan not found', 404);

  if (plan._count.stores > 0) {
    throw new AppError(
      `Cannot delete — ${plan._count.stores} store(s) are currently on this plan`,
      409,
    );
  }

  // A plan can have zero CURRENT subscribers yet still have a checkout in
  // flight: subscribeToPlan sets paystackPlanCode synchronously — before the
  // customer even sees the checkout page — but Store.subscriptionPlanId only
  // gets set later, once payment succeeds (via the charge.success webhook).
  // Deleting the row in that window doesn't stop the charge (Paystack already
  // has the transaction), it just makes the later activateSubscription()
  // write fail on a foreign-key violation once the customer pays — silently,
  // since webhook processing swallows errors after already returning 200 to
  // Paystack. A plan that's ever been linked to real Paystack billing must
  // never be hard-deleted; renaming/repricing it is still fine via update.
  if (plan.paystackPlanCode) {
    throw new AppError(
      'Cannot delete a plan that has been used for billing — a checkout may still be in flight. Edit it instead.',
      409,
    );
  }

  await prisma.subscriptionPlan.delete({ where: { id: planId } });
  await auditLog({
    userId: actorId,
    action: 'DELETE',
    entity: 'SubscriptionPlan',
    entityId: planId,
    metadata: { name: plan.name },
  });
}
