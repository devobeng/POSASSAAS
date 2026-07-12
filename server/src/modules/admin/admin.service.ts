import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error';
import { auditLog } from '../../utils/audit';
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
  status: 'ACTIVE' | 'INACTIVE',
  actorId: string,
) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true },
  });
  if (!store) throw new AppError('Store not found', 404);

  const updated = await prisma.store.update({
    where: { id: storeId },
    data: { subscriptionStatus: status },
    select: { id: true, name: true, subscriptionStatus: true },
  });

  await auditLog({
    userId: actorId,
    action: status === 'ACTIVE' ? 'ACTIVATE_STORE' : 'SUSPEND_STORE',
    entity: 'Store',
    entityId: storeId,
  });

  return updated;
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

  await prisma.subscriptionPlan.delete({ where: { id: planId } });
  await auditLog({
    userId: actorId,
    action: 'DELETE',
    entity: 'SubscriptionPlan',
    entityId: planId,
    metadata: { name: plan.name },
  });
}
