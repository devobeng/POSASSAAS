import request from 'supertest';
import { app } from '../app';
import { signAccessToken } from '../utils/jwt';
import { Prisma } from '@prisma/client';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  prisma: {
    product: { findMany: jest.fn(), findUnique: jest.fn() },
    inventoryItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    stockMovement: { create: jest.fn(), createMany: jest.fn() },
    order: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    branch: { findUnique: jest.fn(), findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../config/database') as {
  prisma: {
    product: { findMany: jest.Mock; findUnique: jest.Mock };
    inventoryItem: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
      updateMany: jest.Mock;
    };
    stockMovement: { create: jest.Mock; createMany: jest.Mock };
    order: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    branch: { findUnique: jest.Mock; findFirst: jest.Mock };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
};

// ─── Tokens ───────────────────────────────────────────────────────────────────

const STORE_ID = 'store-abc';
const BRANCH_ID = 'branch-1';
const PRODUCT_ID = 'product-1';

function cashierToken() {
  return signAccessToken({
    sub: 'cashier-id',
    email: 'cashier@test.com',
    role: 'CASHIER',
    storeId: STORE_ID,
    branchId: BRANCH_ID,
  });
}

function managerToken() {
  return signAccessToken({
    sub: 'mgr-id',
    email: 'mgr@test.com',
    role: 'BRANCH_MANAGER',
    storeId: STORE_ID,
    branchId: BRANCH_ID,
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

// ─── Shared fixture ───────────────────────────────────────────────────────────

const mockProduct = {
  id: PRODUCT_ID,
  name: 'Widget',
  storeId: STORE_ID,
  sellingPrice: new Prisma.Decimal('10.00'),
  taxRate: new Prisma.Decimal('0'),
  isActive: true,
};

const mockOrder = {
  id: 'order-1',
  orderNumber: 'BRA-000001',
  storeId: STORE_ID,
  branchId: BRANCH_ID,
  cashierId: 'cashier-id',
  status: 'COMPLETED',
  subtotal: new Prisma.Decimal('10.00'),
  taxTotal: new Prisma.Decimal('0'),
  discountTotal: new Prisma.Decimal('0'),
  grandTotal: new Prisma.Decimal('10.00'),
  items: [
    {
      id: 'item-1',
      orderId: 'order-1',
      productId: PRODUCT_ID,
      productName: 'Widget',
      unitPrice: new Prisma.Decimal('10.00'),
      quantity: 1,
      lineTotal: new Prisma.Decimal('10.00'),
    },
  ],
  payments: [
    {
      id: 'pay-1',
      orderId: 'order-1',
      method: 'CASH',
      amount: new Prisma.Decimal('10.00'),
      status: 'SUCCESS',
    },
  ],
  cashier: { id: 'cashier-id', name: 'Cashier', email: 'cashier@test.com' },
  branch: { id: BRANCH_ID, name: 'Branch 1' },
  store: { id: STORE_ID, name: 'Test Store', currency: 'GHS' },
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── POST /api/v1/orders ──────────────────────────────────────────────────────

describe('POST /api/v1/orders', () => {
  const validBody = {
    items: [{ productId: PRODUCT_ID, quantity: 1 }],
    payments: [{ method: 'CASH', amount: 10 }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  });

  it('creates an order successfully → 201', async () => {
    prisma.product.findMany.mockResolvedValue([mockProduct]);
    prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.count.mockResolvedValue(0);
    prisma.branch.findUnique.mockResolvedValue({ name: 'Branch 1' });
    prisma.order.create.mockResolvedValue(mockOrder);
    prisma.inventoryItem.findMany.mockResolvedValue([
      { id: 'inv-1', productId: PRODUCT_ID },
    ]);
    prisma.stockMovement.createMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data.orderNumber).toBe('BRA-000001');
  });

  it('rejects order when stock is insufficient → 400', async () => {
    prisma.product.findMany.mockResolvedValue([mockProduct]);
    // updateMany returns count: 0 → insufficient stock
    prisma.inventoryItem.updateMany.mockResolvedValue({ count: 0 });
    prisma.order.count.mockResolvedValue(0);
    prisma.branch.findUnique.mockResolvedValue({ name: 'Branch 1' });

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/insufficient stock/i);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('rejects when payment total does not match order total → 400', async () => {
    prisma.product.findMany.mockResolvedValue([mockProduct]);
    prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.count.mockResolvedValue(0);
    prisma.branch.findUnique.mockResolvedValue({ name: 'Branch 1' });

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({
        items: [{ productId: PRODUCT_ID, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 99 }], // wrong amount
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not match order total/i);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('handles split payment (cash + card) summing to grand total → 201', async () => {
    const multiProduct = {
      ...mockProduct,
      sellingPrice: new Prisma.Decimal('20.00'),
    };
    prisma.product.findMany.mockResolvedValue([multiProduct]);
    prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.count.mockResolvedValue(5);
    prisma.branch.findUnique.mockResolvedValue({ name: 'Branch 1' });
    prisma.order.create.mockResolvedValue({ ...mockOrder, grandTotal: new Prisma.Decimal('20.00') });
    prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'inv-1', productId: PRODUCT_ID }]);
    prisma.stockMovement.createMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({
        items: [{ productId: PRODUCT_ID, quantity: 1 }],
        payments: [
          { method: 'CASH', amount: 15 },
          { method: 'CARD', amount: 5 },
        ],
      });

    expect(res.status).toBe(201);
  });

  it('returns cached response for duplicate idempotency key → 200', async () => {
    prisma.product.findMany.mockResolvedValue([mockProduct]);
    prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.count.mockResolvedValue(0);
    prisma.branch.findUnique.mockResolvedValue({ name: 'Branch 1' });
    prisma.order.create.mockResolvedValue(mockOrder);
    prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'inv-1', productId: PRODUCT_ID }]);
    prisma.stockMovement.createMany.mockResolvedValue({ count: 1 });

    const iKey = `test-idem-${Date.now()}`;

    // First request — creates order
    const first = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .set('idempotency-key', iKey)
      .send(validBody);

    expect(first.status).toBe(201);

    // Second request — hits idempotency cache
    const second = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .set('idempotency-key', iKey)
      .send(validBody);

    expect(second.status).toBe(200);
    // order.create was called exactly once despite two requests
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
  });

  it('STORE_ADMIN cannot create orders (CASHIER only) → 403', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(validBody);

    expect(res.status).toBe(403);
  });

  it('rejects non-existent product → 404', async () => {
    // findMany returns fewer products than requested
    prisma.product.findMany.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send(validBody);

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });
});

// ─── GET /api/v1/orders ───────────────────────────────────────────────────────

describe('GET /api/v1/orders', () => {
  beforeEach(() => jest.clearAllMocks());

  it('STORE_ADMIN sees all orders → 200', async () => {
    prisma.order.findMany.mockResolvedValue([mockOrder]);
    prisma.order.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('CASHIER query is scoped to own orders', async () => {
    prisma.order.findMany.mockResolvedValue([mockOrder]);
    prisma.order.count.mockResolvedValue(1);

    await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ cashierId: 'cashier-id' }),
      }),
    );
  });

  it('BRANCH_MANAGER query is scoped to own branch', async () => {
    prisma.order.findMany.mockResolvedValue([mockOrder]);
    prisma.order.count.mockResolvedValue(1);

    await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${managerToken()}`);

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ branchId: BRANCH_ID }),
      }),
    );
  });
});

// ─── GET /api/v1/orders/:id ───────────────────────────────────────────────────

describe('GET /api/v1/orders/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns order detail → 200', async () => {
    prisma.order.findUnique.mockResolvedValue(mockOrder);

    const res = await request(app)
      .get('/api/v1/orders/order-1')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orderNumber).toBe('BRA-000001');
  });

  it('returns 404 for unknown order', async () => {
    prisma.order.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/orders/no-such-order')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(404);
  });

  it('CASHIER cannot view another cashier order → 404', async () => {
    prisma.order.findUnique.mockResolvedValue({
      ...mockOrder,
      cashierId: 'someone-else',
    });

    const res = await request(app)
      .get('/api/v1/orders/order-1')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(404);
  });
});

// ─── POST /api/v1/orders/:id/refund ──────────────────────────────────────────

describe('POST /api/v1/orders/:id/refund', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  });

  it('refunds a completed order and restores stock → 200', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(mockOrder); // initial fetch
    prisma.inventoryItem.upsert.mockResolvedValue({ id: 'inv-1', quantity: 6 });
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1' });
    prisma.stockMovement.create.mockResolvedValue({ id: 'mov-1' });
    prisma.order.update.mockResolvedValue({ ...mockOrder, status: 'REFUNDED' });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/orders/order-1/refund')
      .set('Authorization', `Bearer ${managerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REFUNDED');

    // Stock was restored via upsert
    expect(prisma.inventoryItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { quantity: { increment: 1 } },
      }),
    );

    // A RETURN stock movement was created
    expect(prisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'RETURN', quantity: 1 }),
      }),
    );
  });

  it('cannot refund an already-refunded order → 409', async () => {
    prisma.order.findUnique.mockResolvedValue({ ...mockOrder, status: 'REFUNDED' });

    const res = await request(app)
      .post('/api/v1/orders/order-1/refund')
      .set('Authorization', `Bearer ${managerToken()}`);

    expect(res.status).toBe(409);
  });

  it('cannot refund a PENDING order → 400', async () => {
    prisma.order.findUnique.mockResolvedValue({ ...mockOrder, status: 'PENDING' });

    const res = await request(app)
      .post('/api/v1/orders/order-1/refund')
      .set('Authorization', `Bearer ${managerToken()}`);

    expect(res.status).toBe(400);
  });

  it('CASHIER cannot refund → 403', async () => {
    const res = await request(app)
      .post('/api/v1/orders/order-1/refund')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(403);
  });

  it('BRANCH_MANAGER cannot refund an order from a different branch → 403', async () => {
    prisma.order.findUnique.mockResolvedValue({
      ...mockOrder,
      branchId: 'different-branch',
    });

    const res = await request(app)
      .post('/api/v1/orders/order-1/refund')
      .set('Authorization', `Bearer ${managerToken()}`);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/v1/orders/:id/receipt ──────────────────────────────────────────

describe('GET /api/v1/orders/:id/receipt', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns receipt payload → 200', async () => {
    prisma.order.findUnique.mockResolvedValue(mockOrder);

    const res = await request(app)
      .get('/api/v1/orders/order-1/receipt')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      orderNumber: 'BRA-000001',
      grandTotal: 10,
      items: [{ productName: 'Widget', quantity: 1, unitPrice: 10, lineTotal: 10 }],
    });
  });

  it('returns 404 for unknown order', async () => {
    prisma.order.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/orders/missing/receipt')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(404);
  });
});
