import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../app';
import { signAccessToken } from '../utils/jwt';

// ── Prisma mock ───────────────────────────────────────────────────────────────
// Mock the database module before any test runs so no real DB connection is made.
jest.mock('../config/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    store: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../config/database') as {
  prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
    store: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
};

// ── Shared fixtures ───────────────────────────────────────────────────────────
const BASE_USER = {
  id: 'user-1',
  email: 'cashier@store.com',
  name: 'Test Cashier',
  role: 'CASHIER' as const,
  isActive: true,
  storeId: 'store-1',
  branchId: 'branch-1',
  failedLoginAttempts: 0,
  lockedUntil: null,
  hashedRefreshToken: null,
  mustChangePassword: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── POST /api/v1/auth/login ───────────────────────────────────────────────────
describe('POST /api/v1/auth/login', () => {
  const PLAIN_PW = 'Password@123';
  let HASHED_PW: string;

  beforeAll(async () => {
    HASHED_PW = await bcrypt.hash(PLAIN_PW, 1); // rounds=1 for test speed
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with accessToken and sets refresh cookie on valid credentials', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...BASE_USER, password: HASHED_PW });
    prisma.user.update.mockResolvedValue({ ...BASE_USER });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: BASE_USER.email, password: PLAIN_PW });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    const cookies: string[] = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c: string) => c.startsWith('pos_rt='))).toBe(true);
  });

  it('returns 401 for wrong password (generic message — no info leak)', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...BASE_USER, password: HASHED_PW });
    prisma.user.update.mockResolvedValue({ ...BASE_USER });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: BASE_USER.email, password: 'WrongPassword1' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('returns 401 for unknown email (same generic message)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@nope.com', password: PLAIN_PW });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('returns 423 when account is locked', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...BASE_USER,
      password: HASHED_PW,
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 20 * 60 * 1000),
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: BASE_USER.email, password: PLAIN_PW });

    expect(res.status).toBe(423);
  });

  it('returns 422 for missing/invalid email format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: PLAIN_PW });

    expect(res.status).toBe(422);
  });

  it('returns 422 for missing password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: BASE_USER.email });

    expect(res.status).toBe(422);
  });

  it('increments failedLoginAttempts on each wrong password', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...BASE_USER, password: HASHED_PW });
    prisma.user.update.mockResolvedValue({ ...BASE_USER });

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: BASE_USER.email, password: 'WrongOnce1' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedLoginAttempts: 1 }),
      }),
    );
  });
});

// ── POST /api/v1/auth/refresh ─────────────────────────────────────────────────
describe('POST /api/v1/auth/refresh', () => {
  it('returns 401 when refresh cookie is absent', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('returns 401 when cookie holds an invalid token string', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'pos_rt=not-a-valid-jwt');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/v1/auth/logout ──────────────────────────────────────────────────
describe('POST /api/v1/auth/logout', () => {
  it('returns 401 without Bearer token', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(401);
  });

  it('clears the refresh cookie on successful logout', async () => {
    prisma.user.update.mockResolvedValue({ ...BASE_USER });

    const token = signAccessToken({
      sub: BASE_USER.id,
      email: BASE_USER.email,
      role: BASE_USER.role,
      storeId: BASE_USER.storeId,
    });

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Cookie should be cleared (maxAge=0 or expires in the past)
    const cookies: string[] = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    const rtCookie = cookies.find((c: string) => c.startsWith('pos_rt='));
    expect(rtCookie).toBeDefined();
    expect(rtCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });
});

// ── GET /api/v1/auth/me ───────────────────────────────────────────────────────
describe('GET /api/v1/auth/me', () => {
  it('returns 401 without Bearer token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns current user profile with valid token', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...BASE_USER,
      mustChangePassword: false,
      store: { id: 'store-1', name: 'Demo', slug: 'demo', currency: 'NGN', subscriptionStatus: 'ACTIVE' },
      branch: { id: 'branch-1', name: 'Main' },
    });

    const token = signAccessToken({
      sub: BASE_USER.id,
      email: BASE_USER.email,
      role: BASE_USER.role,
      storeId: BASE_USER.storeId,
    });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(BASE_USER.email);
    expect(res.body.data.password).toBeUndefined(); // never expose password hash
  });
});

// ── Role-based access control ─────────────────────────────────────────────────
describe('RBAC — /api/v1/auth/admin-only', () => {
  it('returns 403 when a CASHIER hits a STORE_ADMIN route', async () => {
    const cashierToken = signAccessToken({
      sub: 'user-cashier',
      email: 'cashier@store.com',
      role: 'CASHIER',
      storeId: 'store-1',
    });

    const res = await request(app)
      .get('/api/v1/auth/admin-only')
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 403 when a BRANCH_MANAGER hits a STORE_ADMIN route', async () => {
    const managerToken = signAccessToken({
      sub: 'user-manager',
      email: 'manager@store.com',
      role: 'BRANCH_MANAGER',
      storeId: 'store-1',
      branchId: 'branch-1',
    });

    const res = await request(app)
      .get('/api/v1/auth/admin-only')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 200 when a STORE_ADMIN hits a STORE_ADMIN route', async () => {
    const adminToken = signAccessToken({
      sub: 'user-admin',
      email: 'admin@store.com',
      role: 'STORE_ADMIN',
      storeId: 'store-1',
    });

    const res = await request(app)
      .get('/api/v1/auth/admin-only')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  it('returns 200 when SUPER_ADMIN hits a STORE_ADMIN route', async () => {
    const superToken = signAccessToken({
      sub: 'user-super',
      email: 'super@pos.com',
      role: 'SUPER_ADMIN',
    });

    const res = await request(app)
      .get('/api/v1/auth/admin-only')
      .set('Authorization', `Bearer ${superToken}`);

    expect(res.status).toBe(200);
  });
});
