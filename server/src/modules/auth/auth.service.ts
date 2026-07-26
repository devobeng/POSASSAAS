import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../../config/database';
import { hashPassword, comparePassword } from '../../utils/hash';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  signPasswordResetToken,
  verifyPasswordResetToken,
} from '../../utils/jwt';
import { normalizePhone } from '../../utils/phone';
import { sendOtp, verifyOtp } from '../../services/hubtel.service';
import { AppError } from '../../middleware/error';
import { logger } from '../../utils/logger';
import type {
  LoginInput,
  RegisterStoreInput,
  ForgotPasswordRequestInput,
  ForgotPasswordVerifyInput,
  ForgotPasswordResetInput,
} from './auth.schema';
import { seedDefaultCategories } from '../expenses/expenses.service';

const OTP_REQUEST_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const TRIAL_DAYS = 30;

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
  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError('Enter a valid phone number', 422);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ phone }, ...(input.email ? [{ email: input.email }] : [])] },
    select: { id: true },
  });
  if (existing) throw new AppError('An account with that email or phone already exists', 409);

  const slug = await uniqueSlug(slugify(input.storeName));
  const hashedPassword = await hashPassword(input.password);

  // New stores start on the Free plan's limits for a fixed trial window —
  // the plan-selection screen right after signup lets them confirm Free or
  // upgrade; the trial cron (subscription.cron.ts) flips this to EXPIRED
  // once trialEndsAt passes if they haven't picked a plan.
  const freePlan = await prisma.subscriptionPlan.findFirst({ where: { price: 0 } });
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  // Two sequential writes instead of an interactive transaction — compatible
  // with PgBouncer transaction mode. If user.create fails, the orphaned store
  // is cleaned up so the caller can retry.
  const store = await prisma.store.create({
    data: {
      name: input.storeName,
      slug,
      currency: 'GHS',
      subscriptionStatus: 'TRIAL',
      subscriptionPlanId: freePlan?.id,
      trialEndsAt,
    },
  });

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email: input.email,
        phone,
        password: hashedPassword,
        name: input.ownerName,
        role: 'STORE_ADMIN',
        storeId: store.id,
      },
      select: { id: true, email: true, phone: true, name: true, role: true, storeId: true, branchId: true },
    });
  } catch (err) {
    await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
    throw err;
  }

  // Seed default expense categories for the new store (fire-and-forget, non-fatal)
  seedDefaultCategories(store.id).catch(() => undefined);

  logger.info('New store registered', { storeId: store.id, slug });

  const jwtPayload = {
    sub: user.id,
    email: user.email ?? undefined,
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
  const phone = input.phone ? normalizePhone(input.phone) : null;
  const user = input.email
    ? await prisma.user.findUnique({ where: { email: input.email } })
    : phone
      ? await prisma.user.findUnique({ where: { phone } })
      : null;

  // Identical message for unknown identifier and wrong password — prevents enumeration
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
    email: user.email ?? undefined,
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
      phone: user.phone,
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
    email: user.email ?? undefined,
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
      phone: true,
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

// ── SMS (Hubtel OTP) password reset ────────────────────────────────────────

export async function forgotPasswordRequest(input: ForgotPasswordRequestInput) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError('Enter a valid phone number', 422);

  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, isActive: true },
  });

  // Same response shape whether or not the phone is registered — avoids
  // leaking account existence. Unregistered numbers never reach Hubtel, so
  // there's no SMS cost for probing.
  if (!user || !user.isActive) {
    return { requestId: `noop-${crypto.randomUUID()}` };
  }

  const { requestId, prefix } = await sendOtp(phone);

  await prisma.passwordResetRequest.create({
    data: {
      userId: user.id,
      phone,
      requestId,
      prefix,
      expiresAt: new Date(Date.now() + OTP_REQUEST_EXPIRY_MS),
    },
  });

  return { requestId };
}

export async function verifyForgotPasswordOtp(input: ForgotPasswordVerifyInput) {
  const resetRequest = await prisma.passwordResetRequest.findUnique({
    where: { requestId: input.requestId },
  });

  if (!resetRequest || resetRequest.consumed || resetRequest.expiresAt < new Date()) {
    throw new AppError('Invalid or expired code', 400);
  }

  const ok = await verifyOtp({
    requestId: resetRequest.requestId,
    otpCode: input.otpCode,
    prefix: resetRequest.prefix ?? undefined,
  });
  if (!ok) throw new AppError('Invalid or expired code', 400);

  await prisma.passwordResetRequest.update({
    where: { id: resetRequest.id },
    data: { verified: true },
  });

  return {
    resetToken: signPasswordResetToken({ sub: resetRequest.userId, resetRequestId: resetRequest.id }),
  };
}

export async function resetPasswordWithSmsToken(input: ForgotPasswordResetInput) {
  let payload;
  try {
    payload = verifyPasswordResetToken(input.resetToken);
  } catch {
    throw new AppError('Invalid or expired reset token', 401);
  }

  const resetRequest = await prisma.passwordResetRequest.findUnique({
    where: { id: payload.resetRequestId },
  });
  if (
    !resetRequest ||
    resetRequest.userId !== payload.sub ||
    !resetRequest.verified ||
    resetRequest.consumed
  ) {
    throw new AppError('Invalid or expired reset token', 401);
  }

  const hashed = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: payload.sub },
      data: {
        password: hashed,
        mustChangePassword: false,
        hashedRefreshToken: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    }),
    prisma.passwordResetRequest.update({
      where: { id: resetRequest.id },
      data: { consumed: true },
    }),
  ]);

  logger.info('Password reset via SMS OTP', { userId: payload.sub });
}
