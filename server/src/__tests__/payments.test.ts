import request from 'supertest';
import crypto from 'crypto';
import { app } from '../app';
import { signAccessToken } from '../utils/jwt';
import { __clearInMemoryCacheForTests } from '../utils/cache';

// The subscription-status guard now caches its DB read in-process (see
// middleware/subscription.ts). That cache is a module-level singleton, so
// without this it leaks a status set by one test into a later test that
// reuses the same STORE_ID and expects a different status.
beforeEach(() => __clearInMemoryCacheForTests());

// ─── Prisma mock ──────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  prisma: {
    payment: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    store: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    subscriptionPlan: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    branch: {
      count: jest.fn(),
    },
    webhookEvent: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    subscriptionPayment: {
      findUnique: jest.fn(),
      create: jest.fn(),
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
  createPlan: jest.fn(),
  verifyWebhookSignature: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../config/database') as {
  prisma: {
    payment: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock; create: jest.Mock };
    order: { findUnique: jest.Mock; update: jest.Mock };
    store: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    subscriptionPlan: { findUnique: jest.Mock; updateMany: jest.Mock };
    user: { findUnique: jest.Mock; count: jest.Mock };
    branch: { count: jest.Mock };
    webhookEvent: { create: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    subscriptionPayment: { findUnique: jest.Mock; create: jest.Mock };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const paystackSvc = require('../services/paystack.service') as {
  initializeTransaction: jest.Mock;
  verifyTransaction: jest.Mock;
  createCustomer: jest.Mock;
  createPlan: jest.Mock;
  verifyWebhookSignature: jest.Mock;
};

// Every webhook delivery is now persisted before being acked/processed —
// give it a harmless default everywhere so tests that don't care about this
// durability layer don't need to mock it individually.
prisma.webhookEvent.create.mockResolvedValue({ id: 'webhook-event-1' });
prisma.webhookEvent.update.mockResolvedValue({});

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

function adminToken() {
  return signAccessToken({
    sub: 'admin-id',
    email: 'admin@test.com',
    role: 'STORE_ADMIN',
    storeId: STORE_ID,
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

  it('rejects a callbackUrl pointing off this app\'s origin → 422', async () => {
    const res = await request(app)
      .post('/api/v1/payments/initialize')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({ orderId: ORDER_ID, callbackUrl: 'https://evil.example.com/steal' });

    expect(res.status).toBe(422);
    expect(paystackSvc.initializeTransaction).not.toHaveBeenCalled();
  });

  it('accepts a callbackUrl on this app\'s own origin → 200', async () => {
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
      .send({ orderId: ORDER_ID, callbackUrl: 'http://localhost:3000/pos/receipt' });

    expect(res.status).toBe(200);
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

  it('persists the raw event BEFORE acking, and marks it PROCESSED after a successful handler run', async () => {
    const body = buildWebhookBody({
      event: 'charge.success',
      data: { reference: 'ref_durable' },
    });
    paystackSvc.verifyWebhookSignature.mockReturnValue(true);
    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      orderId: 'order-1',
      status: 'PENDING',
      order: { id: 'order-1', storeId: STORE_ID, status: 'PENDING', orderNumber: 'BRA-000001' },
    });
    prisma.$transaction.mockResolvedValue([{}, {}]);

    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sign(body))
      .send(body);

    expect(res.status).toBe(200);
    // A durable row was written for this delivery
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'charge.success', reference: 'ref_durable' }),
      }),
    );

    await new Promise((r) => setTimeout(r, 50));

    // ...and marked PROCESSED once the handler actually finished
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'webhook-event-1' },
        data: expect.objectContaining({ status: 'PROCESSED' }),
      }),
    );
  });

  it('marks the persisted event FAILED (not silently dropped) when the handler throws', async () => {
    const body = buildWebhookBody({
      event: 'charge.success',
      data: { reference: 'ref_boom' },
    });
    paystackSvc.verifyWebhookSignature.mockReturnValue(true);
    prisma.payment.findUnique.mockRejectedValue(new Error('DB exploded'));

    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sign(body))
      .send(body);

    // Still acks 200 — Paystack must not retry-storm us over our own bug
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 50));

    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'webhook-event-1' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
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
      order: { id: ORDER_ID, storeId: STORE_ID, orderNumber: 'BRA-000001' },
    });
    prisma.$transaction.mockResolvedValue([{}, {}]);
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .get('/api/v1/payments/verify/ref_abc')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.paystackStatus).toBe('success');

    // Manual verify mutates payment/order state exactly like the webhook
    // path does, so it needs the same accountability trail.
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PAYMENT_SUCCESS',
          userId: 'cashier-id',
        }),
      }),
    );
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

// ─── POST /api/v1/payments/subscribe (lazy Paystack Plan creation) ────────────

describe('POST /api/v1/payments/subscribe', () => {
  beforeEach(() => jest.clearAllMocks());

  const PLAN_ID = 'plan-pro';

  it('rejects a callbackUrl pointing off this app\'s origin → 422', async () => {
    const res = await request(app)
      .post('/api/v1/payments/subscribe')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ planId: PLAN_ID, callbackUrl: 'https://evil.example.com/steal' });

    expect(res.status).toBe(422);
    expect(paystackSvc.initializeTransaction).not.toHaveBeenCalled();
  });

  function mockBaseLookups(planOverrides: Record<string, unknown> = {}) {
    prisma.store.findUnique.mockResolvedValue({
      id: STORE_ID,
      subscriptionPlanId: 'plan-starter',
      subscriptionStatus: 'ACTIVE',
      paystackCustomerCode: 'CUS_existing',
      paystackSubscriptionCode: null,
      paystackEmailToken: null,
    });
    prisma.subscriptionPlan.findUnique.mockResolvedValueOnce({
      id: PLAN_ID,
      price: '20.00',
      name: 'Pro',
      maxBranches: 10,
      maxUsers: 10,
      paystackPlanCode: null,
      paystackPlanAmount: null,
      ...planOverrides,
    });
    prisma.user.findUnique.mockResolvedValue({ name: 'Jane Admin' });
    prisma.branch.count.mockResolvedValue(1);
    prisma.user.count.mockResolvedValue(1);
  }

  it('creates a Paystack Plan on first-ever paid subscribe and uses it', async () => {
    mockBaseLookups();
    paystackSvc.createPlan.mockResolvedValue({ plan_code: 'PLN_new123' });
    prisma.subscriptionPlan.updateMany.mockResolvedValue({ count: 1 });
    paystackSvc.initializeTransaction.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/sub1',
      access_code: 'access_1',
      reference: 'ref_sub_1',
    });

    const res = await request(app)
      .post('/api/v1/payments/subscribe')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ planId: PLAN_ID });

    expect(res.status).toBe(200);
    expect(paystackSvc.createPlan).toHaveBeenCalledTimes(1);
    expect(prisma.subscriptionPlan.updateMany).toHaveBeenCalledWith({
      where: { id: PLAN_ID, paystackPlanCode: null },
      data: { paystackPlanCode: 'PLN_new123', paystackPlanAmount: 2000 },
    });
    expect(paystackSvc.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'PLN_new123' }),
    );
  });

  it('defers to the winning concurrent request\'s plan code when it loses the optimistic-concurrency race', async () => {
    mockBaseLookups();
    paystackSvc.createPlan.mockResolvedValue({ plan_code: 'PLN_loser789' });
    // This request loses the race — another request already persisted a plan code first.
    prisma.subscriptionPlan.updateMany.mockResolvedValue({ count: 0 });
    // Re-fetch after losing the race returns the winner's plan code.
    prisma.subscriptionPlan.findUnique.mockResolvedValueOnce({
      paystackPlanCode: 'PLN_winner456',
    });
    paystackSvc.initializeTransaction.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/sub2',
      access_code: 'access_2',
      reference: 'ref_sub_2',
    });

    const res = await request(app)
      .post('/api/v1/payments/subscribe')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ planId: PLAN_ID });

    expect(res.status).toBe(200);
    // It still created its own Plan (couldn't know it would lose ahead of time)...
    expect(paystackSvc.createPlan).toHaveBeenCalledTimes(1);
    // ...but must checkout using the WINNER's persisted code, not its own orphaned one.
    expect(paystackSvc.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'PLN_winner456' }),
    );
  });

  it('reuses the cached Paystack Plan code when price has not drifted', async () => {
    mockBaseLookups({ paystackPlanCode: 'PLN_cached', paystackPlanAmount: 2000 });
    paystackSvc.initializeTransaction.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/sub3',
      access_code: 'access_3',
      reference: 'ref_sub_3',
    });

    const res = await request(app)
      .post('/api/v1/payments/subscribe')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ planId: PLAN_ID });

    expect(res.status).toBe(200);
    expect(paystackSvc.createPlan).not.toHaveBeenCalled();
    expect(prisma.subscriptionPlan.updateMany).not.toHaveBeenCalled();
    expect(paystackSvc.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'PLN_cached' }),
    );
  });

  it('blocks a switch that would leave the store over the target plan\'s branch/user limits → 409', async () => {
    mockBaseLookups({ maxBranches: 1, maxUsers: 2 });
    prisma.branch.count.mockResolvedValue(3); // store has 3 active branches
    prisma.user.count.mockResolvedValue(1);

    const res = await request(app)
      .post('/api/v1/payments/subscribe')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ planId: PLAN_ID });

    expect(res.status).toBe(409);
    expect(paystackSvc.createPlan).not.toHaveBeenCalled();
    expect(paystackSvc.initializeTransaction).not.toHaveBeenCalled();
  });
});

// ─── Prepaid (Mobile Money) subscriptions ─────────────────────────────────────

describe('Prepaid Mobile Money subscriptions', () => {
  beforeEach(() => jest.clearAllMocks());

  const PLAN_ID = 'plan-pro';

  function mockSubscribeLookups(storeOverrides: Record<string, unknown> = {}) {
    prisma.store.findUnique.mockResolvedValue({
      id: STORE_ID,
      subscriptionPlanId: 'plan-starter',
      subscriptionStatus: 'ACTIVE',
      paystackCustomerCode: 'CUS_existing',
      paystackSubscriptionCode: null,
      paystackEmailToken: null,
      currentPeriodEnd: null,
      ...storeOverrides,
    });
    prisma.subscriptionPlan.findUnique.mockResolvedValueOnce({
      id: PLAN_ID,
      price: '20.00',
      name: 'Pro',
      maxBranches: 10,
      maxUsers: 10,
      paystackPlanCode: null,
      paystackPlanAmount: null,
    });
    prisma.user.findUnique.mockResolvedValue({ name: 'Jane Admin' });
    prisma.branch.count.mockResolvedValue(1);
    prisma.user.count.mockResolvedValue(1);
    paystackSvc.initializeTransaction.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/momo',
      access_code: 'access_momo',
      reference: 'ref_momo',
    });
  }

  it('initializes a one-off mobile_money GHS charge for price × months, with no Paystack Plan', async () => {
    mockSubscribeLookups();

    const res = await request(app)
      .post('/api/v1/payments/subscribe')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ planId: PLAN_ID, method: 'mobile_money', months: 3 });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({ prepaid: true, months: 3, amount: 6000 }));
    expect(paystackSvc.createPlan).not.toHaveBeenCalled();
    const args = paystackSvc.initializeTransaction.mock.calls[0][0];
    expect(args).toEqual(
      expect.objectContaining({
        amount: 6000,
        currency: 'GHS',
        channels: ['mobile_money'],
        metadata: expect.objectContaining({
          storeId: STORE_ID,
          planId: PLAN_ID,
          type: 'subscription_prepaid',
          months: 3,
          expectedAmount: 6000,
        }),
      }),
    );
    expect(args.plan).toBeUndefined();
  });

  it('lets a prepaid store renew the plan it is already on (not an "already active" no-op)', async () => {
    mockSubscribeLookups({ subscriptionPlanId: PLAN_ID, currentPeriodEnd: new Date(Date.now() + 86_400_000) });

    const res = await request(app)
      .post('/api/v1/payments/subscribe')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ planId: PLAN_ID, method: 'mobile_money', months: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.alreadyActive).toBeUndefined();
    expect(paystackSvc.initializeTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not cancel a live card subscription just for starting a MoMo checkout', async () => {
    mockSubscribeLookups({ paystackSubscriptionCode: 'SUB_card', paystackEmailToken: 'tok' });

    await request(app)
      .post('/api/v1/payments/subscribe')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ planId: PLAN_ID, method: 'mobile_money', months: 1 });

    // cancelExistingSubscription would clear the pointer via store.update
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('rejects an unsupported months value → 422', async () => {
    const res = await request(app)
      .post('/api/v1/payments/subscribe')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ planId: PLAN_ID, method: 'mobile_money', months: 2 });

    expect(res.status).toBe(422);
    expect(paystackSvc.initializeTransaction).not.toHaveBeenCalled();
  });

  async function sendPrepaidWebhook(data: Record<string, unknown>) {
    const body = buildWebhookBody({ event: 'charge.success', data });
    paystackSvc.verifyWebhookSignature.mockReturnValue(true);
    await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sign(body))
      .send(body);
    await new Promise((r) => setTimeout(r, 50));
  }

  const prepaidMeta = {
    storeId: STORE_ID,
    planId: PLAN_ID,
    type: 'subscription_prepaid',
    months: 3,
    expectedAmount: 6000,
  };

  it('webhook credits the period, stacking onto remaining paid time on the same plan', async () => {
    const currentEnd = new Date(Date.UTC(2030, 0, 15));
    const newEnd = new Date(Date.UTC(2030, 3, 15));
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.subscriptionPayment.findUnique.mockResolvedValue(null);
    prisma.store.findUnique.mockResolvedValue({
      subscriptionPlanId: PLAN_ID,
      subscriptionStatus: 'ACTIVE',
      currentPeriodEnd: currentEnd,
      trialEndsAt: null,
      paystackSubscriptionCode: null,
      paystackEmailToken: null,
    });
    prisma.$transaction.mockResolvedValue([{}, {}, {}]);

    await sendPrepaidWebhook({ reference: 'ref_momo', amount: 6000, currency: 'GHS', metadata: prepaidMeta });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.subscriptionPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reference: 'ref_momo',
        months: 3,
        amount: 6000,
        periodStart: currentEnd,
        periodEnd: newEnd,
      }),
    });
    expect(prisma.store.update).toHaveBeenCalledWith({
      where: { id: STORE_ID },
      data: { subscriptionPlanId: PLAN_ID, currentPeriodEnd: newEnd, trialEndsAt: null },
    });
  });

  it('skips a reference that was already credited (webhook + verify both confirm one charge)', async () => {
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.subscriptionPayment.findUnique.mockResolvedValue({ id: 'sp-1', reference: 'ref_momo' });

    await sendPrepaidWebhook({ reference: 'ref_momo', amount: 6000, metadata: prepaidMeta });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('treats a unique-reference race (P2002) as already credited, not a failure', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Prisma } = require('@prisma/client');
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.subscriptionPayment.findUnique.mockResolvedValue(null);
    prisma.store.findUnique.mockResolvedValue({
      subscriptionPlanId: 'plan-starter',
      subscriptionStatus: 'ACTIVE',
      currentPeriodEnd: null,
      trialEndsAt: null,
      paystackSubscriptionCode: null,
      paystackEmailToken: null,
    });
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5' }),
    );

    await sendPrepaidWebhook({ reference: 'ref_momo', amount: 6000, metadata: prepaidMeta });

    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }),
    );
  });

  it('never credits an underpayment', async () => {
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.subscriptionPayment.findUnique.mockResolvedValue(null);

    await sendPrepaidWebhook({ reference: 'ref_momo', amount: 2000, metadata: prepaidMeta });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('blocks writes the moment a prepaid period has lapsed, before the cron flips status → 402', async () => {
    prisma.store.findUnique.mockResolvedValue({
      subscriptionStatus: 'ACTIVE',
      currentPeriodEnd: new Date(Date.now() - 60_000),
    });

    const res = await request(app)
      .post('/api/v1/payments/initialize')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({ orderId: ORDER_ID });

    expect(res.status).toBe(402);
    expect(res.body.errors).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('addMonthsUtc clamps to the end of shorter months', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { addMonthsUtc } = require('../modules/payments/payments.service');
    expect(addMonthsUtc(new Date(Date.UTC(2028, 0, 31)), 1)).toEqual(new Date(Date.UTC(2028, 1, 29)));
    expect(addMonthsUtc(new Date(Date.UTC(2027, 10, 30)), 3)).toEqual(new Date(Date.UTC(2028, 1, 29)));
    expect(addMonthsUtc(new Date(Date.UTC(2027, 0, 10)), 12)).toEqual(new Date(Date.UTC(2028, 0, 10)));
  });
});
