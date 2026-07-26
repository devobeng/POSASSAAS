import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error';
import { auditLog } from '../../utils/audit';
import type { CreateBranchInput, UpdateBranchInput } from './branches.schema';

async function assertBranchLimit(storeId: string): Promise<void> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { subscriptionPlan: { select: { maxBranches: true } } },
  });

  const max = store?.subscriptionPlan?.maxBranches;
  if (!max) return; // no plan linked — no limit enforced

  const active = await prisma.branch.count({ where: { storeId, isActive: true } });
  if (active >= max) {
    throw new AppError(
      `Branch limit reached (${max} max on your plan). Upgrade to add more.`,
      402,
    );
  }
}

// BRANCH_MANAGER and CASHIER are fixed to one branch — they never need, and
// shouldn't see, other branches' names/details. STORE_ADMIN/SUPER_ADMIN see
// the whole store.
const RESTRICTED_ROLES = new Set(['BRANCH_MANAGER', 'CASHIER']);

export async function getBranches(storeId: string, role: string, userBranchId?: string) {
  return prisma.branch.findMany({
    where: {
      storeId,
      ...(RESTRICTED_ROLES.has(role) && { id: userBranchId }),
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { users: { where: { isActive: true } }, orders: true } },
    },
  });
}

export async function getBranch(
  storeId: string,
  branchId: string,
  role: string,
  userBranchId?: string,
) {
  if (RESTRICTED_ROLES.has(role) && branchId !== userBranchId) {
    // Same "not found" (not 403) as other branch-scoped lookups in this app —
    // don't reveal that a branch exists at all to someone who can't see it.
    throw new AppError('Branch not found', 404);
  }

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, storeId },
    include: {
      _count: { select: { users: { where: { isActive: true } }, orders: true } },
    },
  });
  if (!branch) throw new AppError('Branch not found', 404);
  return branch;
}

export async function createBranch(
  storeId: string,
  data: CreateBranchInput,
  actorId: string,
) {
  await assertBranchLimit(storeId);
  const branch = await prisma.branch.create({ data: { storeId, ...data } });
  await auditLog({
    storeId,
    userId: actorId,
    action: 'CREATE',
    entity: 'Branch',
    entityId: branch.id,
    metadata: { name: branch.name },
  });
  return branch;
}

export async function updateBranch(
  storeId: string,
  branchId: string,
  data: UpdateBranchInput,
  actorId: string,
) {
  const existing = await prisma.branch.findFirst({
    where: { id: branchId, storeId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Branch not found', 404);

  const branch = await prisma.branch.update({ where: { id: branchId }, data });
  await auditLog({
    storeId,
    userId: actorId,
    action: 'UPDATE',
    entity: 'Branch',
    entityId: branchId,
    metadata: { fields: Object.keys(data) },
  });
  return branch;
}

export async function deleteBranch(storeId: string, branchId: string, actorId: string) {
  const existing = await prisma.branch.findFirst({
    where: { id: branchId, storeId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Branch not found', 404);

  await prisma.branch.update({ where: { id: branchId }, data: { isActive: false } });
  await auditLog({
    storeId,
    userId: actorId,
    action: 'SOFT_DELETE',
    entity: 'Branch',
    entityId: branchId,
  });
}
