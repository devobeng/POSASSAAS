/**
 * Integration tests for offline-first sync:
 *   1. Same clientOrderId submitted twice → one order, 200 + duplicate:true on retry
 *   2. Batch sync with one bad order → other orders still succeed
 *   3. Offline sale with insufficient stock → succeeds, stockDiscrepancy:true
 *   4. GET /sync/catalog returns products, categories, inventory
 */

import request from 'supertest';
import { app } from '../app';
import { signAccessToken } from '../utils/jwt';
import { Prisma } from '@prisma/client';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  prisma: {
    product: { findMany: jest.fn() },
    inventoryItem: { findMany: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
    stockMovement: { createMany: jest.fn() },
    order: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    branch: { findUnique: jest.fn() },
    category: { findMany: jest.fn() },
    store: { findUniqueOrThrow: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../config/database') as {
  prisma: {
    product: { findMany: jest.Mock };
    inventoryItem: { findMany: jest.Mock; upsert: jest.Mock; updateMany: jest.Mock };
    stockMovement: { createMany: jest.Mock };
    order: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    branch: { findUnique: jest.Mock };
    category: { findMany: jest.Mock };
    store: { findUniqueOrThrow: jest.Mock };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
};

// ─── Tokens ───────────────────────────────────────────────────────────────────

const STORE_ID = 'store-abc';
const BRANCH_ID = 'branch-1';
const PRODUCT_ID = 'prod-1';
const CLIENT_ORDER_ID = '550e8400-e29b-41d4-a716-446655440000';

function cashierToken() {
  return signAccessToken({
    sub: 'cashier-id',
    email: 'cashier@test.com',
    role: 'CASHIER',
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

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const mockProduct = {
  id: PRODUCT_ID,
  name: 'Widget',
  storeId: STORE_ID,
  sellingPrice: new Prisma.Decimal('10.00'),
  taxRate: new Prisma.Decimal('0'),
  isActive: true,
};

function mockOrderFixture(overrides: Record<string, unknown> = {}) {
  return {
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
    clientOrderId: null,
    createdAtClient: null,
    offlineReference: null,
    stockDiscrepancy: false,
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setupOrderMocks(opts: { hasStock?: boolean; stockDiscrepancy?: boolean } = {}) {
  const { hasStock = true, stockDiscrepancy = false } = opts;

  // Handle both array-form (new) and callback-form (legacy) transactions.
  prisma.$transaction.mockImplementation((arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof prisma) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });
  prisma.product.findMany.mockResolvedValue([mockProduct]);
  prisma.order.count.mockResolvedValue(0);
  prisma.branch.findUnique.mockResolvedValue({ name: 'Branch 1' });
  prisma.inventoryItem.findMany.mockResolvedValue([
    { id: 'inv-1', productId: PRODUCT_ID, quantity: 100 },
  ]);
  prisma.stockMovement.createMany.mockResolvedValue({ count: 1 });

  // Online path: updateMany with guard
  prisma.inventoryItem.updateMany.mockResolvedValue({ count: hasStock ? 1 : 0 });

  // Offline path: upsert returns positive or negative quantity
  prisma.inventoryItem.upsert.mockResolvedValue({
    id: 'inv-1',
    productId: PRODUCT_ID,
    branchId: BRANCH_ID,
    quantity: hasStock ? 5 : -1,
    lowStockThreshold: 10,
  });

  prisma.order.create.mockResolvedValue(
    mockOrderFixture({ stockDiscrepancy }),
  );
}

// ─── POST /api/v1/orders — clientOrderId idempotency ─────────────────────────

describe('POST /api/v1/orders — clientOrderId idempotency', () => {
  beforeEach(() => jest.clearAllMocks());

  const body = {
    items: [{ productId: PRODUCT_ID, quantity: 1 }],
    payments: [{ method: 'CASH', amount: 10 }],
    clientOrderId: CLIENT_ORDER_ID,
  };

  it('first submission creates the order → 201, duplicate:false', async () => {
    prisma.order.findFirst.mockResolvedValue(null); // no existing order
    setupOrderMocks();

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.data.duplicate).toBe(false);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
  });

  it('second submission with same clientOrderId returns existing order → 200, duplicate:true', async () => {
    const existingOrder = mockOrderFixture({ clientOrderId: CLIENT_ORDER_ID });
    prisma.order.findFirst.mockResolvedValue(existingOrder);

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.data.duplicate).toBe(true);
    expect(res.body.data.clientOrderId).toBe(CLIENT_ORDER_ID);
    // DB create must never be called
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('online order without clientOrderId still rejects insufficient stock → 400', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    setupOrderMocks();
    prisma.inventoryItem.updateMany.mockResolvedValue({ count: 0 }); // out of stock

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({ items: [{ productId: PRODUCT_ID, quantity: 1 }], payments: [{ method: 'CASH', amount: 10 }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/insufficient stock/i);
  });
});

// ─── POST /api/v1/orders — offline sale with insufficient stock ───────────────

describe('POST /api/v1/orders — offline stock handling', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offline sale succeeds even when stock goes negative, flags stockDiscrepancy:true', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    setupOrderMocks({ hasStock: false, stockDiscrepancy: true });

    const body = {
      items: [{ productId: PRODUCT_ID, quantity: 5 }],
      payments: [{ method: 'CASH', amount: 50 }],
      clientOrderId: '550e8400-e29b-41d4-a716-446655440001',
      offlineReference: 'OFF-DEV001-0001',
      createdAtClient: new Date(Date.now() - 3600_000).toISOString(),
    };

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.data.stockDiscrepancy).toBe(true);
    // Must use upsert (unconditional), not updateMany with guard
    expect(prisma.inventoryItem.upsert).toHaveBeenCalled();
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
  });

  it('offline sale with sufficient stock does not set discrepancy', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    // upsert returns positive quantity
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
    prisma.product.findMany.mockResolvedValue([mockProduct]);
    prisma.order.count.mockResolvedValue(0);
    prisma.branch.findUnique.mockResolvedValue({ name: 'Branch 1' });
    prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'inv-1', productId: PRODUCT_ID }]);
    prisma.stockMovement.createMany.mockResolvedValue({ count: 1 });
    prisma.inventoryItem.upsert.mockResolvedValue({
      id: 'inv-1', productId: PRODUCT_ID, branchId: BRANCH_ID, quantity: 5, lowStockThreshold: 10,
    });
    prisma.order.create.mockResolvedValue(mockOrderFixture({ stockDiscrepancy: false, clientOrderId: '550e8400-e29b-41d4-a716-446655440002' }));

    const body = {
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
      payments: [{ method: 'CASH', amount: 10 }],
      clientOrderId: '550e8400-e29b-41d4-a716-446655440002',
    };

    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.data.stockDiscrepancy).toBe(false);
  });
});

// ─── POST /api/v1/sync/orders — batch sync ───────────────────────────────────

describe('POST /api/v1/sync/orders', () => {
  beforeEach(() => jest.clearAllMocks());

  const goodOrder = {
    clientOrderId: '550e8400-e29b-41d4-a716-446655440010',
    items: [{ productId: PRODUCT_ID, quantity: 1 }],
    payments: [{ method: 'CASH', amount: 10 }],
  };

  const duplicateOrder = {
    clientOrderId: '550e8400-e29b-41d4-a716-446655440011',
    items: [{ productId: PRODUCT_ID, quantity: 1 }],
    payments: [{ method: 'CASH', amount: 10 }],
  };

  const badOrder = {
    clientOrderId: '550e8400-e29b-41d4-a716-446655440012',
    items: [{ productId: PRODUCT_ID, quantity: 1 }],
    payments: [{ method: 'CASH', amount: 999 }], // payment mismatch → will fail
  };

  it('processes each order independently — one failure does not stop others', async () => {
    const existingOrder = mockOrderFixture({ clientOrderId: duplicateOrder.clientOrderId });

    // findFirst: goodOrder → null (new), duplicateOrder → existing, badOrder → null (new but will fail)
    prisma.order.findFirst
      .mockResolvedValueOnce(null)           // goodOrder: not a duplicate
      .mockResolvedValueOnce(existingOrder)  // duplicateOrder: already exists
      .mockResolvedValueOnce(null);          // badOrder: not a duplicate, but payment will fail

    // In the new flow, reads happen BEFORE $transaction — set mocks up front.
    // goodOrder uses these; badOrder fails at payment-validation before any DB calls.
    prisma.product.findMany.mockResolvedValue([mockProduct]);
    prisma.branch.findUnique.mockResolvedValue({ name: 'Branch 1' });
    prisma.inventoryItem.findMany.mockResolvedValue([
      { id: 'inv-1', productId: PRODUCT_ID, quantity: 100 },
    ]);
    prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.count.mockResolvedValue(0);
    prisma.stockMovement.createMany.mockResolvedValue({ count: 1 });
    prisma.order.create.mockResolvedValue(
      mockOrderFixture({ clientOrderId: goodOrder.clientOrderId }),
    );

    const res = await request(app)
      .post('/api/v1/sync/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({ orders: [goodOrder, duplicateOrder, badOrder] });

    expect(res.status).toBe(200);

    const results = res.body.data as Array<{
      clientOrderId: string;
      status: string;
      error?: string;
    }>;

    const goodResult = results.find((r) => r.clientOrderId === goodOrder.clientOrderId);
    const dupResult = results.find((r) => r.clientOrderId === duplicateOrder.clientOrderId);
    const badResult = results.find((r) => r.clientOrderId === badOrder.clientOrderId);

    expect(goodResult?.status).toBe('created');
    expect(dupResult?.status).toBe('duplicate');
    expect(badResult?.status).toBe('failed');
    expect(badResult?.error).toBeDefined();
  });

  it('rejects non-CASHIER attempting batch sync → 403', async () => {
    const res = await request(app)
      .post('/api/v1/sync/orders')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ orders: [goodOrder] });

    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated batch sync → 401', async () => {
    const res = await request(app)
      .post('/api/v1/sync/orders')
      .send({ orders: [goodOrder] });

    expect(res.status).toBe(401);
  });

  it('rejects batch exceeding 50 orders → 422 validation error', async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      ...goodOrder,
      clientOrderId: `550e8400-e29b-41d4-a716-4466554400${String(i).padStart(2, '0')}`,
    }));

    const res = await request(app)
      .post('/api/v1/sync/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({ orders: tooMany });

    // ZodError → 422 Unprocessable Entity
    expect(res.status).toBe(422);
  });
});

// ─── GET /api/v1/sync/catalog ─────────────────────────────────────────────────

describe('GET /api/v1/sync/catalog', () => {
  beforeEach(() => jest.clearAllMocks());

  const mockCategories = [{ id: 'cat-1', name: 'Beverages', updatedAt: new Date() }];
  const mockProducts = [
    {
      id: PRODUCT_ID,
      name: 'Widget',
      sku: 'WID-001',
      barcode: null,
      imageUrl: null,
      sellingPrice: new Prisma.Decimal('10.00'),
      taxRate: new Prisma.Decimal('0'),
      categoryId: 'cat-1',
      updatedAt: new Date(),
    },
  ];
  const mockInventory = [
    { productId: PRODUCT_ID, quantity: 20, lowStockThreshold: 5, updatedAt: new Date() },
  ];
  const mockStore = { name: 'Demo Store', currency: 'GHS' };

  function setupCatalogMocks() {
    prisma.category.findMany.mockResolvedValue(mockCategories);
    prisma.product.findMany.mockResolvedValue(mockProducts);
    prisma.inventoryItem.findMany.mockResolvedValue(mockInventory);
    prisma.store.findUniqueOrThrow.mockResolvedValue(mockStore);
  }

  it('returns full catalog snapshot when no since param', async () => {
    setupCatalogMocks();

    const res = await request(app)
      .get('/api/v1/sync/catalog')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.isDelta).toBe(false);
    expect(data.since).toBeNull();
    expect(data.categories).toHaveLength(1);
    expect(data.products).toHaveLength(1);
    expect(data.products[0].sellingPrice).toBe(10);
    expect(data.inventory).toHaveLength(1);
    expect(data.store.currency).toBe('GHS');
    expect(data.userPermissions.role).toBe('CASHIER');
    expect(data.userPermissions.branchId).toBe(BRANCH_ID);
  });

  it('returns delta catalog when since param given', async () => {
    setupCatalogMocks();

    const since = new Date(Date.now() - 60_000).toISOString();

    const res = await request(app)
      .get(`/api/v1/sync/catalog?since=${encodeURIComponent(since)}`)
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.isDelta).toBe(true);
    expect(res.body.data.since).toBe(since);

    // Products query should have been called with updatedAt filter
    const productCall = prisma.product.findMany.mock.calls[0][0];
    expect(productCall.where).toHaveProperty('updatedAt');
  });

  it('STORE_ADMIN can fetch catalog with explicit branchId query', async () => {
    setupCatalogMocks();

    const res = await request(app)
      .get(`/api/v1/sync/catalog?branchId=${BRANCH_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.userPermissions.role).toBe('STORE_ADMIN');
  });

  it('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/api/v1/sync/catalog');
    expect(res.status).toBe(401);
  });
});
