import request from 'supertest';
import { app } from '../app';
import { signAccessToken } from '../utils/jwt';

jest.mock('../config/database', () => ({
  prisma: {
    store: { findUnique: jest.fn() },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    branch: { findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../config/database') as {
  prisma: {
    store: { findUnique: jest.Mock };
    user: {
      findUnique: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock;
      create: jest.Mock; update: jest.Mock; count: jest.Mock;
    };
    branch: { findFirst: jest.Mock };
    auditLog: { create: jest.Mock };
  };
};

const STORE_ID = 'store-abc';
const BRANCH_ID = 'branch-1';

function token(role: string, extra: Record<string, string> = {}) {
  return signAccessToken({
    sub: `user-${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@test.com`,
    role,
    storeId: STORE_ID,
    ...extra,
  });
}

// ── Role-based access ─────────────────────────────────────────────────────────

describe('POST /api/v1/users — role hierarchy', () => {
  beforeEach(() => jest.clearAllMocks());

  it('CASHIER cannot access user management → 403', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token('CASHIER', { branchId: BRANCH_ID })}`)
      .send({ email: 'new@test.com', name: 'New User', role: 'CASHIER' });

    expect(res.status).toBe(403);
  });

  it('BRANCH_MANAGER cannot create another BRANCH_MANAGER → 403', async () => {
    // assertOutranks throws before any DB call — no mocks needed
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token('BRANCH_MANAGER', { branchId: BRANCH_ID })}`)
      .send({ phone: '+233200000010', email: 'peer@test.com', name: 'Peer Manager', role: 'BRANCH_MANAGER' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/equal to or higher/i);
  });

  it('BRANCH_MANAGER can create CASHIER → 201 (branchId auto-set from token)', async () => {
    prisma.store.findUnique.mockResolvedValue({ subscriptionPlan: { maxUsers: 50 } });
    prisma.user.count.mockResolvedValue(5);
    prisma.user.findFirst.mockResolvedValue(null); // email/phone not taken
    prisma.user.create.mockResolvedValue({
      id: 'user-new',
      email: 'cashier@test.com',
      phone: '+233200000011',
      name: 'New Cashier',
      role: 'CASHIER',
      storeId: STORE_ID,
      branchId: BRANCH_ID, // auto-set to manager's branch
      mustChangePassword: true,
      createdAt: new Date(),
    });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token('BRANCH_MANAGER', { branchId: BRANCH_ID })}`)
      .send({ phone: '+233200000011', email: 'cashier@test.com', name: 'New Cashier', role: 'CASHIER' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.mustChangePassword).toBe(true);
    expect(res.body.data.tempPassword).toBeDefined();
    expect(typeof res.body.data.tempPassword).toBe('string');

    // Verify the create call used the manager's branchId, not the request body's
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ branchId: BRANCH_ID }),
      }),
    );
  });

  it('STORE_ADMIN can create BRANCH_MANAGER → 201', async () => {
    prisma.store.findUnique.mockResolvedValue({ subscriptionPlan: { maxUsers: 50 } });
    prisma.user.count.mockResolvedValue(3);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.branch.findFirst.mockResolvedValue({ id: BRANCH_ID });
    prisma.user.create.mockResolvedValue({
      id: 'user-mgr',
      email: 'mgr@test.com',
      phone: '+233200000012',
      name: 'New Manager',
      role: 'BRANCH_MANAGER',
      storeId: STORE_ID,
      branchId: BRANCH_ID,
      mustChangePassword: true,
      createdAt: new Date(),
    });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`)
      .send({ phone: '+233200000012', email: 'mgr@test.com', name: 'New Manager', role: 'BRANCH_MANAGER', branchId: BRANCH_ID });

    expect(res.status).toBe(201);
    expect(res.body.data.tempPassword).toBeDefined();
  });

  it('rejects a branchId that does not belong to this store → 404', async () => {
    // STORE_ADMIN supplies branchId directly (unlike BRANCH_MANAGER, whose
    // branchId is always forced to their own) — must be validated, or a user
    // could be assigned to another tenant's branch entirely.
    prisma.store.findUnique.mockResolvedValue({ subscriptionPlan: { maxUsers: 50 } });
    prisma.user.count.mockResolvedValue(3);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.branch.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`)
      .send({ phone: '+233200000013', email: 'x@test.com', name: 'Xavier', role: 'CASHIER', branchId: 'other-store-branch' });

    expect(res.status).toBe(404);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('returns 409 when email or phone already exists', async () => {
    prisma.store.findUnique.mockResolvedValue({ subscriptionPlan: { maxUsers: 50 } });
    prisma.user.count.mockResolvedValue(3);
    prisma.user.findFirst.mockResolvedValue({ id: 'existing-user' }); // email/phone taken

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`)
      .send({ phone: '+233200000013', email: 'taken@test.com', name: 'Duplicate', role: 'CASHIER' });

    expect(res.status).toBe(409);
  });
});

// ── Plan limit ────────────────────────────────────────────────────────────────

describe('POST /api/v1/users — plan limit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 402 when active user count equals plan maxUsers', async () => {
    prisma.store.findUnique.mockResolvedValue({ subscriptionPlan: { maxUsers: 5 } });
    prisma.user.count.mockResolvedValue(5); // at limit

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`)
      .send({ phone: '+233200000014', email: 'extra@test.com', name: 'Extra User', role: 'CASHIER' });

    expect(res.status).toBe(402);
    expect(res.body.message).toMatch(/user limit/i);
  });
});

// ── Deactivation self-guard ───────────────────────────────────────────────────

describe('DELETE /api/v1/users/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 when a user tries to deactivate themselves', async () => {
    const selfId = 'user-storeadmin';
    const selfToken = signAccessToken({
      sub: selfId,
      email: 'admin@test.com',
      role: 'STORE_ADMIN',
      storeId: STORE_ID,
    });

    const res = await request(app)
      .delete(`/api/v1/users/${selfId}`)
      .set('Authorization', `Bearer ${selfToken}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/your own account/i);
  });

  it('BRANCH_MANAGER cannot deactivate a user in a different branch → 403', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'target-user',
      role: 'CASHIER',
      branchId: 'branch-other', // different branch
    });

    const res = await request(app)
      .delete('/api/v1/users/target-user')
      .set('Authorization', `Bearer ${token('BRANCH_MANAGER', { branchId: BRANCH_ID })}`)

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/your branch/i);
  });

  it('STORE_ADMIN cannot deactivate another STORE_ADMIN → 403', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'other-admin',
      role: 'STORE_ADMIN', // same rank as actor
      branchId: null,
    });

    const res = await request(app)
      .delete('/api/v1/users/other-admin')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`);

    expect(res.status).toBe(403);
  });
});

// ── Schema validation ─────────────────────────────────────────────────────────

describe('POST /api/v1/users — schema validation', () => {
  it('rejects invalid email → 422', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`)
      .send({ phone: '+233200000015', email: 'not-an-email', name: 'X', role: 'CASHIER' });

    expect(res.status).toBe(422);
  });

  it('rejects an invalid phone number → 422', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`)
      .send({ phone: 'not-a-phone', name: 'X', role: 'CASHIER' });

    expect(res.status).toBe(422);
  });

  it('rejects STORE_ADMIN as a role (not in createUser enum) → 422', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`)
      .send({ phone: '+233200000016', email: 'new@test.com', name: 'X', role: 'STORE_ADMIN' });

    // Zod rejects unknown enum value before the service runs
    expect(res.status).toBe(422);
  });
});
