import crypto from 'crypto';
import { prisma } from '../../config/database';
import { hashPassword, comparePassword } from '../../utils/hash';
import { normalizePhone } from '../../utils/phone';
import { AppError } from '../../middleware/error';
import { auditLog } from '../../utils/audit';
import { assertBranchInStore } from '../inventory/inventory.service';
import type { JwtPayload } from '../../utils/jwt';
import type { Role } from '@prisma/client';
import type { CreateUserInput, UpdateUserInput, GetUsersQuery } from './users.schema';

// ── Role hierarchy ────────────────────────────────────────────────────────────

const ROLE_RANK: Record<string, number> = {
  SUPER_ADMIN: 4,
  STORE_ADMIN: 3,
  BRANCH_MANAGER: 2,
  CASHIER: 1,
};

function assertOutranks(actorRole: string, targetRole: string): void {
  if ((ROLE_RANK[actorRole] ?? 0) <= (ROLE_RANK[targetRole] ?? 0)) {
    throw new AppError(
      'You cannot assign a role equal to or higher than your own',
      403,
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateTempPassword(): string {
  // e.g. "TmpA8kZ3pQ2!" — satisfies uppercase + number + special
  const rand = crypto.randomBytes(8).toString('base64url').slice(0, 8);
  return `Tmp${rand}1!`;
}

async function assertUserLimit(storeId: string): Promise<void> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { subscriptionPlan: { select: { maxUsers: true } } },
  });
  const max = store?.subscriptionPlan?.maxUsers;
  if (!max) return;
  const count = await prisma.user.count({ where: { storeId, isActive: true } });
  if (count >= max) {
    throw new AppError(
      `User limit reached (${max} max on your plan). Upgrade to add more.`,
      402,
    );
  }
}

// ── Service functions ─────────────────────────────────────────────────────────

export async function getUsers(storeId: string, actor: JwtPayload, query: GetUsersQuery) {
  const { page, limit, role, branchId, isActive, search } = query;
  const skip = (page - 1) * limit;

  // BRANCH_MANAGER sees only their branch
  const effectiveBranchId =
    actor.role === 'BRANCH_MANAGER' ? actor.branchId : branchId;

  const where = {
    storeId,
    ...(role ? { role: role as Role } : {}),
    ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true, email: true, phone: true, name: true, role: true, isActive: true,
        storeId: true, branchId: true, mustChangePassword: true, createdAt: true,
        branch: { select: { id: true, name: true } },
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ]);

  return { users, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
}

export async function getUser(storeId: string, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, storeId },
    select: {
      id: true, email: true, phone: true, name: true, role: true, isActive: true,
      storeId: true, branchId: true, mustChangePassword: true, createdAt: true,
      branch: { select: { id: true, name: true } },
    },
  });
  if (!user) throw new AppError('User not found', 404);
  return user;
}

export async function createUser(
  storeId: string,
  data: CreateUserInput,
  actor: JwtPayload,
) {
  assertOutranks(actor.role, data.role);

  // BRANCH_MANAGER can only create CASHIER for their own branch
  if (actor.role === 'BRANCH_MANAGER') {
    if (data.role !== 'CASHIER') {
      throw new AppError('Branch managers can only create cashiers', 403);
    }
    if (!actor.branchId) throw new AppError('You are not assigned to a branch', 403);
    data = { ...data, branchId: actor.branchId };
  } else if (data.branchId) {
    // STORE_ADMIN/SUPER_ADMIN supply branchId directly from the request —
    // must belong to this store, or a user could be assigned to another
    // tenant's branch entirely.
    await assertBranchInStore(storeId, data.branchId);
  }

  await assertUserLimit(storeId);

  const phone = normalizePhone(data.phone);
  if (!phone) throw new AppError('Enter a valid phone number', 422);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ phone }, ...(data.email ? [{ email: data.email }] : [])] },
    select: { id: true },
  });
  if (existing) throw new AppError('An account with that email or phone already exists', 409);

  const tempPassword = generateTempPassword();
  const hashedPassword = await hashPassword(tempPassword);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      phone,
      name: data.name,
      role: data.role as Role,
      password: hashedPassword,
      storeId,
      branchId: data.branchId ?? null,
      mustChangePassword: true,
    },
    select: {
      id: true, email: true, phone: true, name: true, role: true, storeId: true,
      branchId: true, mustChangePassword: true, createdAt: true,
    },
  });

  await auditLog({
    storeId,
    userId: actor.sub,
    action: 'CREATE',
    entity: 'User',
    entityId: user.id,
    metadata: { email: user.email, role: user.role },
  });

  return { user, tempPassword };
}

export async function updateUser(
  storeId: string,
  userId: string,
  data: UpdateUserInput,
  actor: JwtPayload,
) {
  const target = await prisma.user.findFirst({
    where: { id: userId, storeId },
    select: { id: true, role: true, branchId: true },
  });
  if (!target) throw new AppError('User not found', 404);

  assertOutranks(actor.role, target.role);

  if (actor.role === 'BRANCH_MANAGER' && target.branchId !== actor.branchId) {
    throw new AppError('You can only manage users in your branch', 403);
  }

  if (data.branchId) {
    await assertBranchInStore(storeId, data.branchId);
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, email: true, name: true, role: true, isActive: true, branchId: true },
  });

  await auditLog({
    storeId,
    userId: actor.sub,
    action: 'UPDATE',
    entity: 'User',
    entityId: userId,
    metadata: { fields: Object.keys(data) },
  });

  return user;
}

export async function deactivateUser(
  storeId: string,
  userId: string,
  actor: JwtPayload,
) {
  if (userId === actor.sub) {
    throw new AppError('You cannot deactivate your own account', 400);
  }

  const target = await prisma.user.findFirst({
    where: { id: userId, storeId },
    select: { id: true, role: true, branchId: true },
  });
  if (!target) throw new AppError('User not found', 404);

  assertOutranks(actor.role, target.role);

  if (actor.role === 'BRANCH_MANAGER' && target.branchId !== actor.branchId) {
    throw new AppError('You can only manage users in your branch', 403);
  }

  await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

  await auditLog({
    storeId,
    userId: actor.sub,
    action: 'DEACTIVATE',
    entity: 'User',
    entityId: userId,
  });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password: true },
  });
  if (!user) throw new AppError('User not found', 404);

  const valid = await comparePassword(currentPassword, user.password);
  if (!valid) throw new AppError('Current password is incorrect', 401);

  const hashed = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashed, mustChangePassword: false, hashedRefreshToken: null },
  });
}
