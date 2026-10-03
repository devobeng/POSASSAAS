import request from 'supertest';
import { app } from '../app';
import { signAccessToken } from '../utils/jwt';

jest.mock('../config/database', () => ({
  prisma: {
    store: { findUnique: jest.fn(), update: jest.fn() },
    receiptSettings: { findUnique: jest.fn(), upsert: jest.fn() },
    auditLog: { create: jest.fn() },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../config/database') as {
  prisma: {
    store: { findUnique: jest.Mock; update: jest.Mock };
    receiptSettings: { findUnique: jest.Mock; upsert: jest.Mock };
    auditLog: { create: jest.Mock };
  };
};

const STORE_ID = 'store-abc';

function token(role: string) {
  return signAccessToken({ sub: `user-${role}`, email: `${role}@test.com`, role, storeId: STORE_ID });
}

beforeEach(() => jest.clearAllMocks());

// ── GET /api/v1/store ────────────────────────────────────────────────────────
describe('GET /api/v1/store', () => {
  it('STORE_ADMIN can view store profile → 200', async () => {
    prisma.store.findUnique.mockResolvedValue({
      id: STORE_ID, name: 'Demo Store', slug: 'demo-store', currency: 'GHS',
      subscriptionStatus: 'ACTIVE', subscriptionPlan: { name: 'Pro' },
      _count: { branches: 2, users: 5 },
    });

    const res = await request(app)
      .get('/api/v1/store')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Demo Store');
  });

  it('returns 404 when the store record is missing', async () => {
    prisma.store.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/store')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`);

    expect(res.status).toBe(404);
  });

  it('CASHIER cannot view store profile → 403', async () => {
    const res = await request(app)
      .get('/api/v1/store')
      .set('Authorization', `Bearer ${token('CASHIER')}`);

    expect(res.status).toBe(403);
  });

  it('BRANCH_MANAGER cannot view store profile → 403', async () => {
    const res = await request(app)
      .get('/api/v1/store')
      .set('Authorization', `Bearer ${token('BRANCH_MANAGER')}`);

    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/api/v1/store');
    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/v1/store ──────────────────────────────────────────────────────
describe('PATCH /api/v1/store', () => {
  it('STORE_ADMIN can update store profile → 200', async () => {
    prisma.store.update.mockResolvedValue({
      id: STORE_ID, name: 'Renamed Store', slug: 'demo-store', currency: 'NGN',
      subscriptionStatus: 'ACTIVE', logoUrl: null, updatedAt: new Date(),
      stockAdjustmentThreshold: 20,
    });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .patch('/api/v1/store')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`)
      .send({ name: 'Renamed Store', currency: 'ngn' });

    expect(res.status).toBe(200);
    // currency is upper-cased by the schema transform before it reaches the service
    expect(prisma.store.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currency: 'NGN' }) }),
    );
  });

  it('rejects an unknown field (schema is .strict()) → 422', async () => {
    const res = await request(app)
      .patch('/api/v1/store')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`)
      .send({ subscriptionStatus: 'ACTIVE' }); // not a real editable field

    expect(res.status).toBe(422);
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('CASHIER cannot update store profile → 403', async () => {
    const res = await request(app)
      .patch('/api/v1/store')
      .set('Authorization', `Bearer ${token('CASHIER')}`)
      .send({ name: 'Hacked Name' });

    expect(res.status).toBe(403);
    expect(prisma.store.update).not.toHaveBeenCalled();
  });
});

// ── GET /api/v1/store/receipt-settings ───────────────────────────────────────
// Deliberately exempt from the STORE_ADMIN-only gate below — every role
// (including CASHIER) needs this to print a receipt at the till.
describe('GET /api/v1/store/receipt-settings', () => {
  it('returns saved settings when they exist → 200', async () => {
    prisma.receiptSettings.findUnique.mockResolvedValue({
      storeId: STORE_ID, headerText: 'Welcome!', footerText: null,
      paperWidth: 80, showLogo: true, showQrCode: true,
      weightedBarcodeEnabled: false, weightedBarcodeType: 'price',
    });

    const res = await request(app)
      .get('/api/v1/store/receipt-settings')
      .set('Authorization', `Bearer ${token('CASHIER')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.headerText).toBe('Welcome!');
  });

  it('returns sensible defaults when no settings have been saved yet', async () => {
    prisma.receiptSettings.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/store/receipt-settings')
      .set('Authorization', `Bearer ${token('CASHIER')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.paperWidth).toBe(80);
    expect(res.body.data.showLogo).toBe(true);
  });
});

// ── PUT /api/v1/store/receipt-settings ───────────────────────────────────────
describe('PUT /api/v1/store/receipt-settings', () => {
  it('STORE_ADMIN can update receipt settings → 200', async () => {
    prisma.receiptSettings.upsert.mockResolvedValue({
      id: 'rs-1', storeId: STORE_ID, headerText: 'Thanks for shopping!',
      footerText: null, paperWidth: 58, showLogo: false, showQrCode: true,
      weightedBarcodeEnabled: false, weightedBarcodeType: 'price',
    });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .put('/api/v1/store/receipt-settings')
      .set('Authorization', `Bearer ${token('STORE_ADMIN')}`)
      .send({ headerText: 'Thanks for shopping!', paperWidth: '58', showLogo: false });

    expect(res.status).toBe(200);
    expect(prisma.receiptSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: STORE_ID },
        update: expect.objectContaining({ paperWidth: 58 }), // '58' string coerced to number
      }),
    );
  });

  it('CASHIER cannot update receipt settings → 403', async () => {
    const res = await request(app)
      .put('/api/v1/store/receipt-settings')
      .set('Authorization', `Bearer ${token('CASHIER')}`)
      .send({ headerText: 'Nope' });

    expect(res.status).toBe(403);
    expect(prisma.receiptSettings.upsert).not.toHaveBeenCalled();
  });
});

// ── POST /api/v1/store/audit ─────────────────────────────────────────────────
// Any authenticated role can log an audit entry (e.g. cashiers logging
// cash-drawer open/close events).
describe('POST /api/v1/store/audit', () => {
  it('CASHIER can log a known client event (drawer open) → 200', async () => {
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/store/audit')
      .set('Authorization', `Bearer ${token('CASHIER')}`)
      .send({ action: 'DRAWER_OPENED', entity: 'CashDrawer', entityId: 'drawer-1' });

    expect(res.status).toBe(200);
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('rejects an action outside the client-event allowlist → 422', async () => {
    // A CASHIER (or anyone) forging an arbitrary/system-looking action —
    // e.g. impersonating a server-generated audit entry — must be rejected
    // by schema validation before it ever reaches auditLog.create.
    const res = await request(app)
      .post('/api/v1/store/audit')
      .set('Authorization', `Bearer ${token('CASHIER')}`)
      .send({ action: 'PAYMENT_SUCCESS', entity: 'CashDrawer', entityId: 'drawer-1' });

    expect(res.status).toBe(422);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects oversized metadata → 422', async () => {
    const res = await request(app)
      .post('/api/v1/store/audit')
      .set('Authorization', `Bearer ${token('CASHIER')}`)
      .send({
        action: 'DRAWER_OPENED',
        entity: 'CashDrawer',
        entityId: 'drawer-1',
        metadata: { blob: 'x'.repeat(3000) },
      });

    expect(res.status).toBe(422);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
