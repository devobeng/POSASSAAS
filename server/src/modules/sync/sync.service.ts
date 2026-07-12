import { prisma } from '../../config/database';
import { createOrder } from '../orders/orders.service';
import type { CreateOrderInput } from '../orders/orders.schema';
import type { BatchSyncInput, CatalogQuery } from './sync.schema';

// ─── Batch sync ───────────────────────────────────────────────────────────────

export interface OrderSyncResult {
  clientOrderId: string;
  status: 'created' | 'duplicate' | 'failed';
  orderId?: string;
  orderNumber?: string;
  stockDiscrepancy?: boolean;
  error?: string;
}

export async function syncOrders(
  storeId: string,
  cashierId: string,
  branchId: string,
  input: BatchSyncInput,
): Promise<OrderSyncResult[]> {
  const results: OrderSyncResult[] = [];

  for (const orderData of input.orders) {
    const clientOrderId = orderData.clientOrderId!;
    try {
      const { order, duplicate } = await createOrder(
        storeId,
        cashierId,
        branchId,
        orderData as CreateOrderInput,
      );

      results.push({
        clientOrderId,
        status: duplicate ? 'duplicate' : 'created',
        orderId: order.id,
        orderNumber: order.orderNumber,
        stockDiscrepancy: order.stockDiscrepancy,
      });
    } catch (err) {
      results.push({
        clientOrderId,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return results;
}

// ─── Catalog snapshot ─────────────────────────────────────────────────────────

export async function getCatalog(
  storeId: string,
  role: string,
  userId: string,
  userBranchId: string | undefined,
  query: CatalogQuery,
) {
  const since = query.since ? new Date(query.since) : undefined;

  // BRANCH_MANAGER / CASHIER are scoped to their own branch
  const effectiveBranchId =
    role === 'BRANCH_MANAGER' || role === 'CASHIER'
      ? userBranchId
      : query.branchId;

  // Date filter for delta sync
  const sinceFilter = since ? { updatedAt: { gt: since } } : {};

  const [categories, products, inventoryItems, store] = await Promise.all([
    // Categories updated since timestamp (or all)
    prisma.category.findMany({
      where: { storeId, ...sinceFilter },
      select: { id: true, name: true, updatedAt: true },
      orderBy: { name: 'asc' },
    }),

    // Products updated since timestamp (or all)
    prisma.product.findMany({
      where: { storeId, isActive: true, ...sinceFilter },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        imageUrl: true,
        sellingPrice: true,
        taxRate: true,
        categoryId: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
    }),

    // Branch inventory (scoped to branch when role requires it)
    effectiveBranchId
      ? prisma.inventoryItem.findMany({
          where: {
            branchId: effectiveBranchId,
            ...(since ? { updatedAt: { gt: since } } : {}),
          },
          select: {
            productId: true,
            quantity: true,
            lowStockThreshold: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([] as {
          productId: string;
          quantity: number;
          lowStockThreshold: number;
          updatedAt: Date;
        }[]),

    // Store settings (currency, tax baseline)
    prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { currency: true, name: true },
    }),
  ]);

  const syncedAt = new Date().toISOString();

  return {
    syncedAt,
    since: since?.toISOString() ?? null,
    isDelta: Boolean(since),
    store,
    categories,
    products: products.map((p) => ({
      ...p,
      sellingPrice: Number(p.sellingPrice),
      taxRate: Number(p.taxRate),
    })),
    inventory: inventoryItems,
    userPermissions: {
      role,
      userId,
      branchId: userBranchId ?? null,
      storeId,
    },
  };
}

