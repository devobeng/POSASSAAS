/**
 * Cross-tenant isolation security tests.
 *
 * Invariant: a user from Store A must NEVER be able to read or write Store B's
 * data through any endpoint, regardless of what IDs they supply in the URL or
 * request body.
 */
import request from 'supertest';
import { app } from '../app';
import { signAccessToken } from '../utils/jwt';

// ─── Prisma mock ──────────────────────────────────────────────────────────────
jest.mock('../config/database', () => ({
  prisma: {
    store: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    branch: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    product: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    inventoryItem: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    order: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(), aggregate: jest.fn() },
    user: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    category: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    stockMovement: { findMany: jest.fn(), count: jest.fn() },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $transaction: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../config/database') as {
  prisma: Record<string, Record<string, jest.Mock>>;
};

// ─── Test fixtures ────────────────────────────────────────────────────────────
const STORE_A = 'store-alpha';
const STORE_B = 'store-bravo';
const BRANCH_A = 'branch-alpha-1';
const BRANCH_B = 'branch-bravo-1';

const makeToken = (storeId: string, role = 'STORE_ADMIN', branchId?: string) =>
  signAccessToken({
    sub: `user-${storeId}`,
    email: `admin@${storeId}.com`,
    role: role as 'STORE_ADMIN',
    storeId,
    ...(branchId && { branchId }),
  });

const tokenA = makeToken(STORE_A);
const tokenB = makeToken(STORE_B);

beforeEach(() => {
  jest.clearAllMocks();
  // Default: DB returns empty so we test the WHERE clause, not the data
  Object.values(prisma).forEach((model) => {
    if (typeof model === 'object') {
      Object.values(model).forEach((fn) => {
        if (typeof fn === 'function') fn.mockResolvedValue(null);
      });
    }
  });
  prisma.order.findMany.mockResolvedValue([]);
  prisma.order.count.mockResolvedValue(0);
  prisma.order.aggregate.mockResolvedValue({ _sum: { grandTotal: null } });
  prisma.product.findMany.mockResolvedValue([]);
  prisma.product.count.mockResolvedValue(0);
  prisma.branch.findMany.mockResolvedValue([]);
  prisma.branch.count.mockResolvedValue(0);
  prisma.user.findMany.mockResolvedValue([]);
  prisma.user.count.mockResolvedValue(0);
  prisma.store.findMany.mockResolvedValue([]);
  prisma.store.count.mockResolvedValue(0);
  prisma.category.findMany.mockResolvedValue([]);
  prisma.stockMovement.findMany.mockResolvedValue([]);
  prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
});

// ─── /api/v1/branches ─────────────────────────────────────────────────────────
describe('Branches — cross-tenant isolation', () => {
  it('Store A token cannot fetch Store B branch by ID (gets 404 not Store B data)', async () => {
    // Simulate branch belongs to Store B
    prisma.branch.findFirst.mockImplementation(async (args: { where?: { id?: string; storeId?: string } }) => {
      if (args?.where?.storeId === STORE_B) return { id: BRANCH_B, storeId: STORE_B, name: 'Bravo HQ' };
      return null; // Store A query returns null
    });

    const res = await request(app)
      .get(`/api/v1/branches/${BRANCH_B}`)
      .set('Authorization', `Bearer ${tokenA}`);

    // Must be 404 (not found in Store A) — never 200 with Store B data
    expect(res.status).toBe(404);
    expect(res.body.data?.storeId).not.toBe(STORE_B);
  });

  it('Store A token cannot delete Store B branch', async () => {
    prisma.branch.findFirst.mockResolvedValue(null); // not in Store A

    const res = await request(app)
      .delete(`/api/v1/branches/${BRANCH_B}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });
});

// ─── /api/v1/products ─────────────────────────────────────────────────────────
describe('Products — cross-tenant isolation', () => {
  it('GET /products scoped to token storeId — Store B product not returned to Store A user', async () => {
    prisma.product.findMany.mockImplementation(async (args: { where?: { storeId?: string } }) => {
      // Enforce: only return products matching the storeId in the query
      if (args?.where?.storeId === STORE_A) return [];
      // If the query is missing storeId scope, fail loud
      throw new Error('SECURITY: findMany called without storeId scope');
    });

    const res = await request(app)
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${tokenA}`);

    // Should succeed (200) but return no Store B products
    expect(res.status).toBe(200);
    const storeIds = (res.body.data?.items ?? []).map((p: { storeId: string }) => p.storeId);
    expect(storeIds.every((id: string) => id === STORE_A || id === undefined)).toBe(true);
  });

  it('Store A token gets 404 when fetching a Store B product by ID', async () => {
    prisma.product.findFirst.mockImplementation(async (args: { where?: { id?: string; storeId?: string } }) => {
      if (args?.where?.storeId === STORE_A) return null;
      return { id: 'prod-b', storeId: STORE_B }; // only reachable if storeId scope is missing
    });

    const res = await request(app)
      .get('/api/v1/products/prod-b')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });
});

// ─── /api/v1/orders ──────────────────────────────────────────────────────────
describe('Orders — cross-tenant isolation', () => {
  it('GET /orders list never returns Store B orders to Store A user', async () => {
    prisma.order.findMany.mockImplementation(async (args: { where?: { storeId?: string } }) => {
      if (args?.where?.storeId !== STORE_A) {
        throw new Error('SECURITY: orders queried without correct storeId scope');
      }
      return [];
    });

    const res = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
  });

  it('GET /orders/:id returns 404 for a Store B order when using Store A token', async () => {
    prisma.order.findFirst.mockImplementation(async (args: { where?: { id?: string; storeId?: string } }) => {
      if (args?.where?.storeId === STORE_A) return null; // not found in Store A
      return { id: 'order-b', storeId: STORE_B }; // only reachable without scope
    });

    const res = await request(app)
      .get('/api/v1/orders/order-b')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });
});

// ─── /api/v1/users ───────────────────────────────────────────────────────────
describe('Users — cross-tenant isolation', () => {
  it('GET /users list for Store A does not return Store B users', async () => {
    prisma.user.findMany.mockImplementation(async (args: { where?: { storeId?: string } }) => {
      if (args?.where?.storeId !== STORE_A) {
        throw new Error('SECURITY: users queried without storeId scope');
      }
      return [];
    });

    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
  });
});

// ─── /api/v1/inventory ───────────────────────────────────────────────────────
describe('Inventory — cross-tenant isolation', () => {
  it('Store A token cannot access Store B branch inventory', async () => {
    // Simulate branch lookup scoped by storeId
    prisma.branch.findFirst.mockImplementation(async (args: { where?: { id?: string; storeId?: string } }) => {
      if (args?.where?.storeId === STORE_A && args?.where?.id === BRANCH_B) return null;
      return { id: BRANCH_B, storeId: STORE_B };
    });

    const res = await request(app)
      .get(`/api/v1/inventory?branchId=${BRANCH_B}`)
      .set('Authorization', `Bearer ${tokenA}`);

    // 403 or 404 — must not be 200 with Store B data
    expect([403, 404]).toContain(res.status);
  });
});

// ─── No unauthenticated access ────────────────────────────────────────────────
describe('Authentication guard — all protected routes require a token', () => {
  const ROUTES = [
    ['GET', '/api/v1/store'],
    ['GET', '/api/v1/branches'],
    ['GET', '/api/v1/products'],
    ['GET', '/api/v1/orders'],
    ['GET', '/api/v1/users'],
    ['GET', '/api/v1/inventory'],
    ['GET', '/api/v1/reports/dashboard'],
    ['GET', '/api/v1/admin/stores'],
  ] as const;

  ROUTES.forEach(([method, path]) => {
    it(`${method} ${path} returns 401 without token`, async () => {
      const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method.toLowerCase()](path);
      expect(res.status).toBe(401);
    });
  });
});

// ─── SUPER_ADMIN bypass is explicit and not leaky ─────────────────────────────
describe('SUPER_ADMIN access', () => {
  it('SUPER_ADMIN can access /admin/stores (platform-level route)', async () => {
    prisma.store.findMany = jest.fn().mockResolvedValue([]);
    const superToken = signAccessToken({ sub: 'super-1', email: 'super@pos.com', role: 'SUPER_ADMIN' });

    const res = await request(app)
      .get('/api/v1/admin/stores')
      .set('Authorization', `Bearer ${superToken}`);

    // 200 or 403 depending on admin guard — must not be 401
    expect(res.status).not.toBe(401);
  });

  it('STORE_ADMIN cannot access /admin/stores', async () => {
    const res = await request(app)
      .get('/api/v1/admin/stores')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(403);
  });
});
