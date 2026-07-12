import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database';
import { hashPassword, comparePassword } from '../../utils/hash';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { AppError } from '../../middleware/error';
import { logger } from '../../utils/logger';
import type { LoginInput, RegisterStoreInput } from './auth.schema';
import { seedDefaultCategories } from '../expenses/expenses.service';

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// ── Slug helpers ──────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 0;
  for (;;) {
    const exists = await prisma.store.findUnique({ where: { slug }, select: { id: true } });
    if (!exists) return slug;
    n++;
    slug = `${base}-${n}`;
  }
}

// ── Service functions ─────────────────────────────────────────────────────────

export async function registerStore(input: RegisterStoreInput) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) throw new AppError('An account with that email already exists', 409);

  const slug = await uniqueSlug(slugify(input.storeName));
  const hashedPassword = await hashPassword(input.password);

  const { store, user } = await prisma.$transaction(async (tx) => {
    const store = await tx.store.create({
      data: { name: input.storeName, slug, currency: 'GHS', subscriptionStatus: 'TRIAL' },
    });
    const user = await tx.user.create({
      data: {
        email: input.email,
        password: hashedPassword,
        name: input.ownerName,
        role: 'STORE_ADMIN',
        storeId: store.id,
      },
      select: { id: true, email: true, name: true, role: true, storeId: true, branchId: true },
    });
    return { store, user };
  });

  // Seed default expense categories for the new store (fire-and-forget, non-fatal)
  seedDefaultCategories(store.id).catch(() => undefined);

  logger.info('New store registered', { storeId: store.id, slug });

  const jwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    storeId: user.storeId ?? undefined,
  };
  const refreshToken = signRefreshToken({ sub: user.id });
  const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: { hashedRefreshToken },
  });

  return {
    accessToken: signAccessToken(jwtPayload),
    refreshToken,
    user,
    store: { id: store.id, name: store.name, slug: store.slug },
  };
}

export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Identical message for unknown email and wrong password — prevents enumeration
  if (!user || !user.isActive) throw new AppError('Invalid email or password', 401);

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError('Account temporarily locked. Try again later or contact support.', 423);
  }

  const valid = await comparePassword(input.password, user.password);

  if (!valid) {
    const newAttempts = user.failedLoginAttempts + 1;
    const lockout = newAttempts >= LOCKOUT_THRESHOLD;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: newAttempts,
        lockedUntil: lockout ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
      },
    });
    if (lockout) {
      logger.warn('Account locked after failed attempts', { userId: user.id });
    }
    throw new AppError('Invalid email or password', 401);
  }

  // Success — rotate refresh token and reset lockout counters
  const refreshToken = signRefreshToken({ sub: user.id });
  const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, hashedRefreshToken },
  });

  const jwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    storeId: user.storeId ?? undefined,
    branchId: user.branchId ?? undefined,
  };

  return {
    accessToken: signAccessToken(jwtPayload),
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      storeId: user.storeId,
      branchId: user.branchId,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

export async function refreshTokens(token: string) {
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new AppError('Invalid refresh token', 401);
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive || !user.hashedRefreshToken) {
    throw new AppError('Invalid refresh token', 401);
  }

  const valid = await bcrypt.compare(token, user.hashedRefreshToken);
  if (!valid) throw new AppError('Invalid refresh token', 401);

  // Rotate: issue new pair and store only the new hash (old token is now invalid)
  const newRefreshToken = signRefreshToken({ sub: user.id });
  const hashedRefreshToken = await bcrypt.hash(newRefreshToken, 10);
  await prisma.user.update({ where: { id: user.id }, data: { hashedRefreshToken } });

  const jwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    storeId: user.storeId ?? undefined,
    branchId: user.branchId ?? undefined,
  };

  return { accessToken: signAccessToken(jwtPayload), refreshToken: newRefreshToken };
}

export async function logoutUser(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { hashedRefreshToken: null },
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      storeId: true,
      branchId: true,
      mustChangePassword: true,
      createdAt: true,
      store: {
        select: { id: true, name: true, slug: true, currency: true, subscriptionStatus: true },
      },
      branch: { select: { id: true, name: true } },
    },
  });
  if (!user) throw new AppError('User not found', 404);
  return user;
}
