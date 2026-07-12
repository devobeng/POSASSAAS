import request from 'supertest';
import { app } from '../app';
import { signAccessToken } from '../utils/jwt';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  prisma: {
    category: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    inventoryItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    stockMovement: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
    },
    branch: {
      findFirst: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../config/database') as {
  prisma: {
    category: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    product: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    inventoryItem: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    stockMovement: {
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      createMany: jest.Mock;
    };
    branch: { findFirst: jest.Mock };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
};

// ─── Tokens ───────────────────────────────────────────────────────────────────

const STORE_ID = 'store-abc';
const BRANCH_ID = 'branch-1';
const BRANCH_ID_2 = 'branch-2';
const PRODUCT_ID = 'product-1';

function adminToken() {
  return signAccessToken({ sub: 'admin-id', email: 'admin@test.com', role: 'STORE_ADMIN', storeId: STORE_ID });
}

function managerToken(branchId = BRANCH_ID) {
  return signAccessToken({ sub: 'mgr-id', email: 'mgr@test.com', role: 'BRANCH_MANAGER', storeId: STORE_ID, branchId });
}

function cashierToken() {
  return signAccessToken({ sub: 'cashier-id', email: 'cashier@test.com', role: 'CASHIER', storeId: STORE_ID, branchId: BRANCH_ID });
}

// ─── CATEGORIES ───────────────────────────────────────────────────────────────

describe('GET /api/v1/categories', () => {
  beforeEach(() => jest.clearAllMocks());

  it('STORE_ADMIN can list categories → 200', async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: 'cat-1', name: 'Electronics', storeId: STORE_ID, _count: { products: 3 } },
    ]);

    const res = await request(app)
      .get('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Electronics');
  });

  it('BRANCH_MANAGER can list categories → 200', async () => {
    prisma.category.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/categories')
      .set('Authorization', `Bearer ${managerToken()}`);

    expect(res.status).toBe(200);
  });

  it('CASHIER is denied → 403', async () => {
    const res = await request(app)
      .get('/api/v1/categories')
      .set('Authorization', `Bearer ${cashierToken()}`);

    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/categories', () => {
  beforeEach(() => jest.clearAllMocks());

  it('STORE_ADMIN can create category → 201', async () => {
    prisma.category.create.mockResolvedValue({
      id: 'cat-new',
      storeId: STORE_ID,
      name: 'Beverages',
      _count: { products: 0 },
    });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Beverages' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Beverages');
  });

  it('BRANCH_MANAGER cannot create category → 403', async () => {
    const res = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ name: 'Beverages' });

    expect(res.status).toBe(403);
  });

  it('rejects empty name → 422', async () => {
    const res = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: '' });

    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/categories/:id — product guard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 409 when category has products', async () => {
    prisma.category.findFirst.mockResolvedValue({
      id: 'cat-1',
      _count: { products: 5 },
    });

    const res = await request(app)
      .delete('/api/v1/categories/cat-1')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/5 product/i);
  });

  it('succeeds when category is empty', async () => {
    prisma.category.findFirst.mockResolvedValue({
      id: 'cat-1',
      _count: { products: 0 },
    });
    prisma.category.delete.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/v1/categories/cat-1')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
  });
});

// ─── PRODUCTS ─────────────────────────────────────────────────────────────────

describe('POST /api/v1/products', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates product with auto-generated SKU when none provided → 201', async () => {
    prisma.product.findFirst.mockResolvedValue(null); // no SKU collision
    prisma.product.create.mockResolvedValue({
      id: PRODUCT_ID,
      storeId: STORE_ID,
      name: 'Widget',
      sku: 'WIDG-AABBCC',
      barcode: null,
      imageUrl: null,
      costPrice: 500,
      sellingPrice: 999,
      taxRate: 0,
      isActive: true,
      categoryId: null,
      category: null,
    });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Widget', costPrice: 500, sellingPrice: 999 });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Widget');
  });

  it('uses provided SKU and does not auto-generate → 201', async () => {
    prisma.product.create.mockResolvedValue({
      id: PRODUCT_ID,
      name: 'Widget',
      sku: 'MY-SKU-001',
      category: null,
    });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Widget', sku: 'MY-SKU-001', costPrice: 500, sellingPrice: 999 });

    expect(res.status).toBe(201);
    // create was called with the explicit SKU, not a generated one
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sku: 'MY-SKU-001' }) }),
    );
  });

  it('BRANCH_MANAGER cannot create products → 403', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ name: 'Widget', costPrice: 500, sellingPrice: 999 });

    expect(res.status).toBe(403);
  });

  it('rejects negative costPrice → 422', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Widget', costPrice: -1, sellingPrice: 999 });

    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/products — pagination', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns paginated product list with meta → 200', async () => {
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', name: 'Widget', sku: 'W001', category: null },
      { id: 'p2', name: 'Gadget', sku: 'G001', category: null },
    ]);
    prisma.product.count.mockResolvedValue(42);

    const res = await request(app)
      .get('/api/v1/products?page=2&limit=2')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ total: 42, page: 2, limit: 2, totalPages: 21 });
  });
});

// ─── INVENTORY ────────────────────────────────────────────────────────────────

describe('GET /api/v1/inventory', () => {
  beforeEach(() => jest.clearAllMocks());

  it('STORE_ADMIN must supply branchId → 400 when missing', async () => {
    const res = await request(app)
      .get('/api/v1/inventory')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/branchId/i);
  });

  it('BRANCH_MANAGER always uses their own branchId from token', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: BRANCH_ID });
    prisma.inventoryItem.findMany.mockResolvedValue([]);
    prisma.inventoryItem.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/v1/inventory')
      .set('Authorization', `Bearer ${managerToken()}`);

    expect(res.status).toBe(200);
    // Service was called with the branch from token, not a query param
    expect(prisma.branch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: BRANCH_ID }) }),
    );
  });

  it('STORE_ADMIN can query a specific branch → 200', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: BRANCH_ID });
    prisma.inventoryItem.findMany.mockResolvedValue([
      {
        id: 'inv-1',
        productId: PRODUCT_ID,
        branchId: BRANCH_ID,
        quantity: 5,
        lowStockThreshold: 10,
        product: { id: PRODUCT_ID, name: 'Widget', sku: 'W001', barcode: null, imageUrl: null, sellingPrice: 999, costPrice: 500, taxRate: 0, category: null },
      },
    ]);
    prisma.inventoryItem.count.mockResolvedValue(1);

    const res = await request(app)
      .get(`/api/v1/inventory?branchId=${BRANCH_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].isLowStock).toBe(true); // quantity(5) <= threshold(10)
    expect(res.body.data[0].quantity).toBe(5);
  });
});

// ─── STOCK ADJUSTMENT ─────────────────────────────────────────────────────────

describe('POST /api/v1/inventory/adjust', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Make $transaction pass through the callback synchronously
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
  });

  it('STORE_ADMIN can add stock → 200', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: BRANCH_ID });
    prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID });
    prisma.inventoryItem.upsert.mockResolvedValue({ id: 'inv-1', quantity: 0 });
    prisma.inventoryItem.update.mockResolvedValue({ id: 'inv-1', quantity: 20 });
    prisma.stockMovement.create.mockResolvedValue({ id: 'mv-1', quantity: 20, type: 'ADJUSTMENT' });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/inventory/adjust')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ branchId: BRANCH_ID, productId: PRODUCT_ID, quantity: 20, note: 'Receiving shipment' });

    expect(res.status).toBe(200);
  });

  it('BRANCH_MANAGER always uses their own branchId from token (ignores body branchId)', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: BRANCH_ID });
    prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID });
    prisma.inventoryItem.upsert.mockResolvedValue({ id: 'inv-1', quantity: 0 });
    prisma.inventoryItem.update.mockResolvedValue({ id: 'inv-1', quantity: 5 });
    prisma.stockMovement.create.mockResolvedValue({ id: 'mv-1' });
    prisma.auditLog.create.mockResolvedValue({});

    // Send a valid body but omit branchId — the controller derives it from the JWT
    const res = await request(app)
      .post('/api/v1/inventory/adjust')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ productId: PRODUCT_ID, quantity: 5, note: 'Adjustment test' });

    expect(res.status).toBe(200);
    // The service should have been given the manager's token branchId, not anything from the body
    expect(prisma.branch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: BRANCH_ID }) }),
    );
  });

  it('returns 400 when subtracting more stock than available', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: BRANCH_ID });
    prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID });
    prisma.inventoryItem.upsert.mockResolvedValue({ id: 'inv-1', quantity: 3 });
    // Guard: updateMany returns count=0 → insufficient stock
    prisma.inventoryItem.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .post('/api/v1/inventory/adjust')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ branchId: BRANCH_ID, productId: PRODUCT_ID, quantity: -10, note: 'Correction' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/insufficient stock/i);
  });

  it('positive adjustment always succeeds regardless of current stock → 200', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: BRANCH_ID });
    prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID });
    prisma.inventoryItem.upsert.mockResolvedValue({ id: 'inv-1', quantity: 0 });
    prisma.inventoryItem.update.mockResolvedValue({ id: 'inv-1', quantity: 50 });
    prisma.stockMovement.create.mockResolvedValue({ id: 'mv-1' });
    prisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/inventory/adjust')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ branchId: BRANCH_ID, productId: PRODUCT_ID, quantity: 50, note: 'Stock count' });

    expect(res.status).toBe(200);
    // updateMany should NOT have been called for a positive adjustment
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(prisma.inventoryItem.update).toHaveBeenCalled();
  });

  it('rejects zero quantity → 422', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/adjust')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ branchId: BRANCH_ID, productId: PRODUCT_ID, quantity: 0, note: 'Test' });

    expect(res.status).toBe(422);
  });

  it('rejects missing note → 422', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/adjust')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ branchId: BRANCH_ID, productId: PRODUCT_ID, quantity: 5 });

    expect(res.status).toBe(422);
  });
});

// ─── CONCURRENT STOCK DEDUCTIONS ─────────────────────────────────────────────

describe('Concurrent stock deductions — stock guard prevents negative inventory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
  });

  it('only one of N simultaneous deductions succeeds when stock covers only one', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: BRANCH_ID });
    prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID });
    prisma.inventoryItem.upsert.mockResolvedValue({ id: 'inv-1', quantity: 10 });

    // Simulate DB-level CAS: only the first concurrent caller "wins" the updateMany guard.
    // Subsequent callers find quantity < 10 and receive count=0.
    let winnerPicked = false;
    prisma.inventoryItem.updateMany.mockImplementation(() => {
      if (!winnerPicked) {
        winnerPicked = true;
        return Promise.resolve({ count: 1 });
      }
      return Promise.resolve({ count: 0 }); // all others: insufficient stock
    });

    prisma.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1', quantity: 0 });
    prisma.stockMovement.create.mockResolvedValue({ id: 'mv-1' });
    prisma.auditLog.create.mockResolvedValue({});

    // Fire 5 concurrent deductions of 10 units
    const CONCURRENCY = 5;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        request(app)
          .post('/api/v1/inventory/adjust')
          .set('Authorization', `Bearer ${adminToken()}`)
          .send({
            branchId: BRANCH_ID,
            productId: PRODUCT_ID,
            quantity: -10,
            note: 'concurrent deduction',
          }),
      ),
    );

    const successes = responses.filter((r) => r.status === 200);
    const failures = responses.filter((r) => r.status === 400);

    // Exactly one request should have succeeded (the one that "won" the DB guard)
    expect(successes).toHaveLength(1);
    // All others should be rejected as insufficient stock
    expect(failures).toHaveLength(CONCURRENCY - 1);
    failures.forEach((r) => {
      expect(r.body.message).toMatch(/insufficient stock/i);
    });
  });

  it('guard prevents negative stock — updateMany count=0 always triggers 400', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: BRANCH_ID });
    prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID });
    prisma.inventoryItem.upsert.mockResolvedValue({ id: 'inv-1', quantity: 0 });
    // No stock: every deduction attempt fails at the DB guard
    prisma.inventoryItem.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .post('/api/v1/inventory/adjust')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        branchId: BRANCH_ID,
        productId: PRODUCT_ID,
        quantity: -1,
        note: 'deduct from empty',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/insufficient/i);
    // Critically, stockMovement.create was never called — no movement recorded for a failed deduction
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
  });
});

// ─── STOCK TRANSFER ───────────────────────────────────────────────────────────

describe('POST /api/v1/inventory/transfer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
  });

  it('STORE_ADMIN can transfer stock between branches → 200', async () => {
    prisma.branch.findFirst
      .mockResolvedValueOnce({ id: BRANCH_ID })   // fromBranch exists
      .mockResolvedValueOnce({ id: BRANCH_ID_2 }); // toBranch exists
    prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID });
    prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-src', quantity: 40 });
    prisma.inventoryItem.upsert.mockResolvedValue({ id: 'inv-dest', quantity: 10 });
    prisma.stockMovement.createMany.mockResolvedValue({ count: 2 });

    const res = await request(app)
      .post('/api/v1/inventory/transfer')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        productId: PRODUCT_ID,
        fromBranchId: BRANCH_ID,
        toBranchId: BRANCH_ID_2,
        quantity: 10,
        note: 'Branch restock',
      });

    expect(res.status).toBe(200);
    expect(prisma.stockMovement.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ type: 'TRANSFER_OUT', quantity: -10 }),
          expect.objectContaining({ type: 'TRANSFER_IN', quantity: 10 }),
        ]),
      }),
    );
  });

  it('returns 400 when source branch has insufficient stock', async () => {
    prisma.branch.findFirst
      .mockResolvedValueOnce({ id: BRANCH_ID })
      .mockResolvedValueOnce({ id: BRANCH_ID_2 });
    prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID });
    prisma.inventoryItem.updateMany.mockResolvedValue({ count: 0 }); // guard fails

    const res = await request(app)
      .post('/api/v1/inventory/transfer')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        productId: PRODUCT_ID,
        fromBranchId: BRANCH_ID,
        toBranchId: BRANCH_ID_2,
        quantity: 999,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/insufficient stock/i);
  });

  it('BRANCH_MANAGER cannot transfer from a different branch → 403', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/transfer')
      .set('Authorization', `Bearer ${managerToken(BRANCH_ID)}`)
      .send({
        productId: PRODUCT_ID,
        fromBranchId: BRANCH_ID_2, // not their branch
        toBranchId: BRANCH_ID,
        quantity: 5,
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/your own branch/i);
  });

  it('rejects same fromBranchId and toBranchId → 422', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/transfer')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        productId: PRODUCT_ID,
        fromBranchId: BRANCH_ID,
        toBranchId: BRANCH_ID, // same!
        quantity: 5,
      });

    expect(res.status).toBe(422);
  });
});

// ─── LOW STOCK ────────────────────────────────────────────────────────────────

describe('GET /api/v1/inventory/low-stock', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns items at or below threshold → 200', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 'inv-1',
        productId: PRODUCT_ID,
        branchId: BRANCH_ID,
        quantity: 2,
        lowStockThreshold: 10,
        productName: 'Widget',
        sku: 'W001',
        imageUrl: null,
        branchName: 'Main Branch',
      },
    ]);

    const res = await request(app)
      .get('/api/v1/inventory/low-stock')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].quantity).toBeLessThanOrEqual(res.body.data[0].lowStockThreshold);
  });

  it('BRANCH_MANAGER sees only their branch low-stock items', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/inventory/low-stock')
      .set('Authorization', `Bearer ${managerToken()}`);

    expect(res.status).toBe(200);
    // $queryRaw was called — branchId derived from token (not query param)
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
});

// ─── MOVEMENT HISTORY ─────────────────────────────────────────────────────────

describe('GET /api/v1/inventory/movements', () => {
  beforeEach(() => jest.clearAllMocks());

  it('STORE_ADMIN gets paginated movement history → 200', async () => {
    prisma.stockMovement.findMany.mockResolvedValue([
      {
        id: 'mv-1',
        type: 'ADJUSTMENT',
        quantity: 10,
        note: 'Stock count',
        createdAt: new Date(),
        inventoryItem: {
          product: { id: PRODUCT_ID, name: 'Widget', sku: 'W001' },
          branch: { id: BRANCH_ID, name: 'Main Branch' },
        },
        user: { id: 'admin-id', name: 'Admin' },
      },
    ]);
    prisma.stockMovement.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/v1/inventory/movements')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('BRANCH_MANAGER cannot view another branch movements → 403', async () => {
    const res = await request(app)
      .get(`/api/v1/inventory/movements?branchId=${BRANCH_ID_2}`)
      .set('Authorization', `Bearer ${managerToken(BRANCH_ID)}`);

    expect(res.status).toBe(403);
  });
});
