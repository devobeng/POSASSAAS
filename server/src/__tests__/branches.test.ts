import request from 'supertest';
import { app } from '../app';
import { signAccessToken } from '../utils/jwt';

jest.mock('../config/database', () => ({
  prisma: {
    store: { findUnique: jest.fn() },
    branch: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../config/database') as {
  prisma: {
    store: { findUnique: jest.Mock };
    branch: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock; update: jest.Mock; count: jest.Mock };
    auditLog: { create: jest.Mock };
  };
};

const STORE_ID = 'store-abc';
const BRANCH_ID = 'branch-1';
const OTHER_BRANCH_ID = 'branch-2';

function token(role: string, branchId?: string) {
  return signAccessToken({ sub: `user-${role}`, email: `${role}@test.com`, role, storeId: STORE_ID, branchId });
}

describe('Branch access control', () => {
  beforeEach(() => jest.clearAllMocks());

  it('CASHIER cannot create branches → 403', async () => {
    const res = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${token('CASHIER')}`)
      .send({ name: 'New Branch' });

    expect(res.status).toBe(403);
  });

  it('BRANCH_MANAGER cannot create branches → 403', async () => {
    const res = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${token('BRANCH_MANAGER')}`)
      .send({ name: 'New Branch' });

    expect(res.status).toBe(403);
  });

  it('STORE_ADMIN without auth cannot access branches → 401', async () => {
    const res = await request(app).get('/api/v1/branches');
    expect(res.status).toBe(401);
  });
});

describe('Branch plan limit enforcement', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 402 when active branch count equals plan maxBranches', async () => {
    prisma.store.findUnique.mockResolvedValue({
      subscriptionPlan: { maxBranches: 2 },
    });
    prisma.branch.count.mockResolvedValue(2); // already at limit

    const res = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`)
      .send({ name: 'Third Branch' });

    expect(res.status).toBe(402);
    expect(res.body.message).toMatch(/branch limit/i);
  });

  it('allows creation when below the plan limit', async () => {
    prisma.store.findUnique.mockResolvedValue({
      subscriptionPlan: { maxBranches: 5 },
    });
    prisma.branch.count.mockResolvedValue(3); // under limit
    prisma.branch.create.mockResolvedValue({
      id: 'branch-new',
      storeId: STORE_ID,
      name: 'Another Branch',
      address: null,
      phone: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`)
      .send({ name: 'Another Branch' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Another Branch');
  });

  it('allows creation when store has no subscription plan (dev/free)', async () => {
    prisma.store.findUnique.mockResolvedValue({ subscriptionPlan: null });
    prisma.branch.create.mockResolvedValue({
      id: 'branch-new',
      storeId: STORE_ID,
      name: 'Free Branch',
      address: null,
      phone: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`)
      .send({ name: 'Free Branch' });

    expect(res.status).toBe(201);
  });
});

describe('Branch soft-delete', () => {
  beforeEach(() => jest.clearAllMocks());

  it('DELETE sets isActive=false, does not hard-delete', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: 'branch-1' });
    prisma.branch.update.mockResolvedValue({ id: 'branch-1', isActive: false });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/v1/branches/branch-1')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`);

    expect(res.status).toBe(200);
    expect(prisma.branch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });

  it('returns 404 for a branch not belonging to the store', async () => {
    prisma.branch.findFirst.mockResolvedValue(null); // not found in this store

    const res = await request(app)
      .delete('/api/v1/branches/other-stores-branch')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`);

    expect(res.status).toBe(404);
  });
});

describe('Branch visibility — BRANCH_MANAGER/CASHIER scoped to their own branch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('GET /branches only queries the caller\'s own branch for BRANCH_MANAGER', async () => {
    prisma.branch.findMany.mockResolvedValue([{ id: BRANCH_ID, name: 'Main Branch' }]);

    const res = await request(app)
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${token('BRANCH_MANAGER', BRANCH_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.branch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ storeId: STORE_ID, id: BRANCH_ID }) }),
    );
  });

  it('GET /branches is NOT restricted to one branch for STORE_ADMIN', async () => {
    prisma.branch.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`);

    const whereArg = prisma.branch.findMany.mock.calls[0][0].where;
    expect(whereArg).not.toHaveProperty('id');
  });

  it('GET /branches/:id returns 404 for CASHIER requesting a different branch', async () => {
    const res = await request(app)
      .get(`/api/v1/branches/${OTHER_BRANCH_ID}`)
      .set('Authorization', `Bearer ${token('CASHIER', BRANCH_ID)}`);

    expect(res.status).toBe(404);
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
  });

  it('GET /branches/:id succeeds for BRANCH_MANAGER requesting their own branch', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: BRANCH_ID, name: 'Main Branch' });

    const res = await request(app)
      .get(`/api/v1/branches/${BRANCH_ID}`)
      .set('Authorization', `Bearer ${token('BRANCH_MANAGER', BRANCH_ID)}`);

    expect(res.status).toBe(200);
  });
});
