import request from 'supertest';
import { app } from '../app';
import { signAccessToken } from '../utils/jwt';

jest.mock('../config/database', () => ({
  prisma: {
    store: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
    user: { count: jest.fn() },
    order: { aggregate: jest.fn(), count: jest.fn() },
    subscriptionPlan: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../config/database') as {
  prisma: {
    store: { findUnique: jest.Mock; findMany: jest.Mock; count: jest.Mock; update: jest.Mock };
    user: { count: jest.Mock };
    order: { aggregate: jest.Mock; count: jest.Mock };
    subscriptionPlan: {
      findMany: jest.Mock; findUnique: jest.Mock;
      create: jest.Mock; update: jest.Mock; delete: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };
};

const superAdminToken = signAccessToken({
  sub: 'super-admin-id',
  email: 'super@pos.com',
  role: 'SUPER_ADMIN',
});

function nonSuperToken(role: string) {
  return signAccessToken({
    sub: `user-${role}`,
    email: `${role}@store.com`,
    role,
    storeId: 'store-1',
  });
}

// ── RBAC guard ────────────────────────────────────────────────────────────────

describe('Admin routes — access control', () => {
  it('STORE_ADMIN cannot access /admin/stats → 403', async () => {
    const res = await request(app)
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${nonSuperToken('STORE_ADMIN')}`);

    expect(res.status).toBe(403);
  });

  it('BRANCH_MANAGER cannot access /admin/stats → 403', async () => {
    const res = await request(app)
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${nonSuperToken('BRANCH_MANAGER')}`);

    expect(res.status).toBe(403);
  });

  it('CASHIER cannot access /admin/stores → 403', async () => {
    const res = await request(app)
      .get('/api/v1/admin/stores')
      .set('Authorization', `Bearer ${nonSuperToken('CASHIER')}`);

    expect(res.status).toBe(403);
  });

  it('unauthenticated request → 401', async () => {
    const res = await request(app).get('/api/v1/admin/stats');
    expect(res.status).toBe(401);
  });
});

// ── Stats ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/stats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('SUPER_ADMIN gets platform stats → 200', async () => {
    prisma.store.count
      .mockResolvedValueOnce(42)   // totalStores
      .mockResolvedValueOnce(30);  // activeStores
    prisma.user.count.mockResolvedValue(150);
    prisma.order.aggregate.mockResolvedValue({ _sum: { grandTotal: 500000 } });
    prisma.order.count.mockResolvedValue(1200);

    const res = await request(app)
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      totalStores: 42,
      activeStores: 30,
      totalUsers: 150,
      totalOrders: 1200,
      gmv: 500000,
    });
  });

  it('returns gmv=0 when no completed orders exist', async () => {
    prisma.store.count.mockResolvedValue(0);
    prisma.user.count.mockResolvedValue(0);
    prisma.order.aggregate.mockResolvedValue({ _sum: { grandTotal: null } });
    prisma.order.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.gmv).toBe(0);
  });
});

// ── Store suspend / activate ──────────────────────────────────────────────────

describe('Admin store status management', () => {
  beforeEach(() => jest.clearAllMocks());

  it('SUPER_ADMIN can suspend a store', async () => {
    prisma.store.findUnique.mockResolvedValue({ id: 'store-1' });
    prisma.store.update.mockResolvedValue({
      id: 'store-1',
      name: 'Demo Store',
      subscriptionStatus: 'INACTIVE',
    });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/admin/stores/store-1/suspend')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.subscriptionStatus).toBe('INACTIVE');
    expect(prisma.store.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { subscriptionStatus: 'INACTIVE' } }),
    );
  });

  it('SUPER_ADMIN can activate a suspended store', async () => {
    prisma.store.findUnique.mockResolvedValue({ id: 'store-1' });
    prisma.store.update.mockResolvedValue({
      id: 'store-1',
      name: 'Demo Store',
      subscriptionStatus: 'ACTIVE',
    });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/admin/stores/store-1/activate')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.subscriptionStatus).toBe('ACTIVE');
  });

  it('returns 404 when store does not exist', async () => {
    prisma.store.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/admin/stores/ghost-store/suspend')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(404);
  });
});

// ── Subscription plan CRUD ────────────────────────────────────────────────────

describe('Admin subscription plans', () => {
  beforeEach(() => jest.clearAllMocks());

  it('SUPER_ADMIN can create a plan', async () => {
    const newPlan = {
      id: 'plan-1', name: 'Enterprise', price: 99.99,
      maxBranches: 50, maxUsers: 500, features: { analytics: true },
      createdAt: new Date(), updatedAt: new Date(),
    };
    prisma.subscriptionPlan.create.mockResolvedValue(newPlan);
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/admin/plans')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Enterprise', price: 99.99, maxBranches: 50, maxUsers: 500, features: { analytics: true } });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Enterprise');
  });

  it('cannot delete a plan that has stores on it → 409', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'plan-1',
      name: 'Pro',
      _count: { stores: 3 }, // 3 stores on this plan
    });

    const res = await request(app)
      .delete('/api/v1/admin/plans/plan-1')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/3 store/i);
  });
});
