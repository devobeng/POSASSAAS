import request from 'supertest';
import crypto from 'crypto';
import { app } from '../app';
import { signAccessToken } from '../utils/jwt';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  prisma: {
    payment: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    store: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    subscriptionPlan: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

// ─── Paystack service mock ────────────────────────────────────────────────────

jest.mock('../services/paystack.service', () => ({
  initializeTransaction: jest.fn(),
  verifyTransaction: jest.fn(),
  createCustomer: jest.fn(),
  verifyWebhookSignature: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../config/database') as {
  prisma: {
    payment: { findUnique: jest.Mock; update: jest.Mock };
    order: { findUnique: jest.Mock; update: jest.Mock };
    store: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    subscriptionPlan: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const paystackSvc = require('../services/paystack.service') as {
  initializeTransaction: jest.Mock;
  verifyTransaction: jest.Mock;
  createCustomer: jest.Mock;
  verifyWebhookSignature: jest.Mock;
};

// ─── Tokens ───────────────────────────────────────────────────────────────────

const STORE_ID = 'store-abc';
const ORDER_ID = 'order-1';

function cashierToken() {
  return signAccessToken({
    sub: 'cashier-id',
    email: 'cashier@test.com',
    role: 'CASHIER',
    storeId: STORE_ID,
    branchId: 'branch-1',
  });
}


// ─── POST /api/v1/payments/initialize ────────────────────────────────────────

describe('POST /api/v1/payments/initialize', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns authorization_url for a PAYSTACK pending payment → 200', async () => {
    prisma.store.findUnique.mockResolvedValue({ subscriptionStatus: 'ACTIVE' });
    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_ID,
      storeId: STORE_ID,
      grandTotal: '10.00',
      payments: [
        { id: 'pay-1', method: 'PAYSTACK', status: 'PENDING', amount: '10.00' },
      ],
    });
    prisma.payment.update.mockResolvedValue({});
    paystackSvc.initializeTransaction.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/test',
      access_code: 'acc_test',
      reference: 'ref_abc',
    });

    const res = await request(app)
      .post('/api/v1/payments/initialize')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({ orderId: ORDER_ID });

    expect(res.status).toBe(200);
    expect(res.body.data.authorization_url).toBe('https://checkout.paystack.com/test');
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { paystackReference: 'ref_abc' },
      }),
    );
  });

  it('returns 400 when order has no pending PAYSTACK payment', async () => {
    prisma.store.findUnique.mockResolvedValue({ subscriptionStatus: 'ACTIVE' });
    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_ID,
      storeId: STORE_ID,
      payments: [{ id: 'pay-1', method: 'CASH', status: 'SUCCESS', amount: '10.00' }],
    });

    const res = await request(app)
      .post('/api/v1/payments/initialize')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({ orderId: ORDER_ID });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no pending paystack payment/i);
  });

  it('returns 404 for unknown order', async () => {
    prisma.store.findUnique.mockResolvedValue({ subscriptionStatus: 'ACTIVE' });
    prisma.order.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/payments/initialize')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({ orderId: 'no-such-order' });

    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated request → 401', async () => {
    const res = await request(app)
      .post('/api/v1/payments/initialize')
      .send({ orderId: ORDER_ID });

    expect(res.status).toBe(401);
  });
});

// ─── POST /api/v1/payments/webhook ────────────────────────────────────────────
// Send the body as a JSON *string*, not a Buffer. When supertest receives a
// Buffer with Content-Type: application/json it JSON-stringifies it (turning
// it into {"type":"Buffer","data":[…]}), which breaks event parsing. Sending
// a string passes the bytes through untouched, so express.raw() stores a
// proper Buffer and (req.body as Buffer).toString('utf-8') recovers the JSON.

function buildWebhookBody(event: object): string {
  return JSON.stringify(event);
}

function sign(body: string, secret = 'test-secret'): string {
  return crypto.createHmac('sha512', secret).update(body).digest('hex');
}

describe('POST /api/v1/payments/webhook', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 immediately when signature is valid', async () => {
    const body = buildWebhookBody({ event: 'charge.success', data: { reference: 'ref_1' } });
    paystackSvc.verifyWebhookSignature.mockReturnValue(true);

    // Payment not found → handler logs and skips (no error thrown)
    prisma.payment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sign(body))
      .send(body);

    expect(res.status).toBe(200);
  });

  it('returns 401 when signature is invalid', async () => {
    const body = buildWebhookBody({ event: 'charge.success', data: { reference: 'ref_1' } });
    paystackSvc.verifyWebhookSignature.mockReturnValue(false);

    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', 'bad-sig')
      .send(body);

    expect(res.status).toBe(401);
  });

  it('returns 400 when signature header is missing', async () => {
    const body = buildWebhookBody({ event: 'charge.success', data: {} });

    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(400);
  });

  it('charge.success marks payment SUCCESS and order COMPLETED (idempotent)', async () => {
    const body = buildWebhookBody({
      event: 'charge.success',
      data: { reference: 'ref_ok' },
    });
    paystackSvc.verifyWebhookSignature.mockReturnValue(true);

    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      orderId: 'order-1',
      status: 'PENDING',
      order: { id: 'order-1', storeId: STORE_ID, status: 'PENDING', orderNumber: 'BRA-000001' },
    });
    prisma.$transaction.mockResolvedValue([{}, {}]);
    prisma.auditLog.create.mockResolvedValue({});

    await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sign(body))
      .send(body);

    // Give the async handler time to run
    await new Promise((r) => setTimeout(r, 50));

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('charge.success is idempotent — skips already-SUCCESS payment', async () => {
    const body = buildWebhookBody({
      event: 'charge.success',
      data: { reference: 'ref_dup' },
    });
    paystackSvc.verifyWebhookSignature.mockReturnValue(true);

    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      orderId: 'order-1',
      status: 'SUCCESS', // already processed
      order: { id: 'order-1', storeId: STORE_ID, status: 'COMPLETED', orderNumber: 'BRA-000001' },
    });

    await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sign(body))
      .send(body);

    await new Promise((r) => setTimeout(r, 50));

    // Transaction must NOT be called again
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ─── GET /api/v1/payments/verify/:reference ───────────────────────────────────

describe('GET /api/v1/payments/verify/:reference', () => {
  beforeEach(() => jest.clearAllMocks());

  it('verifies a successful Paystack transaction → 200', async () => {
    paystackSvc.verifyTransaction.mockResolvedValue({
      status: 'success',
      reference: 'ref_abc',
      amount: 1000,
      customer: { email: 'cashier@test.com', customer_code: 'CUS_xyz' },
      metadata: {},
    });

    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      orderId: ORDER_ID,
      status: 'PENDING',
      order: { id: ORDER_ID, storeId: STORE_ID },
    });
    prisma.$transaction.mockResolvedValue([{}, {}]);

    const res = await request(app)
      .get('/api/v1/payments/verify/ref_abc')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.paystackStatus).toBe('success');
  });

  it('returns 404 for unknown reference', async () => {
    paystackSvc.verifyTransaction.mockResolvedValue({
      status: 'failed',
      reference: 'ref_nope',
      amount: 0,
      customer: { email: '', customer_code: '' },
      metadata: {},
    });
    prisma.payment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/payments/verify/ref_nope')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/api/v1/payments/verify/ref_abc');
    expect(res.status).toBe(401);
  });
});

// ─── Subscription guard middleware ────────────────────────────────────────────

describe('Subscription guard (requireActiveSubscription)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('blocks POST when subscription is INACTIVE → 402', async () => {
    // Use the initialize endpoint as a proxy — it goes through the guard
    // (we apply the guard in the test via the products router which uses it)
    // Instead, test indirectly: mock the store as INACTIVE and hit initialize
    prisma.store.findUnique.mockResolvedValue({ subscriptionStatus: 'INACTIVE' });

    // The subscription guard is applied inside specific routers.
    // Here we test it directly by checking the middleware response.
    // Since paymentsRouter applies it, hitting /initialize will trigger the guard.
    const res = await request(app)
      .post('/api/v1/payments/initialize')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({ orderId: ORDER_ID });

    // Guard fires before the service (status INACTIVE → 402)
    expect(res.status).toBe(402);
    expect(res.body.errors).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('allows GET requests even when subscription is INACTIVE → passes through', async () => {
    paystackSvc.verifyTransaction.mockResolvedValue({
      status: 'failed',
      reference: 'ref_x',
      amount: 0,
      customer: { email: '', customer_code: '' },
      metadata: {},
    });
    prisma.store.findUnique.mockResolvedValue({ subscriptionStatus: 'INACTIVE' });
    prisma.payment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/payments/verify/ref_x')
      .set('Authorization', `Bearer ${cashierToken()}`);

    // GET is allowed; 404 because payment doesn't exist — not 402
    expect(res.status).toBe(404);
  });
});
