import { Prisma, StockMovementType, AdjustmentReason, StockAdjustmentRequestStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error';
import { auditLog } from '../../utils/audit';
import type {
  InventoryQuery,
  MovementsQuery,
  ListAdjustmentRequestsQuery,
} from './inventory.schema';

// ─── Guards ───────────────────────────────────────────────────────────────────

async function assertBranchInStore(storeId: string, branchId: string): Promise<void> {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, storeId, isActive: true },
    select: { id: true },
  });
  if (!branch) throw new AppError('Branch not found or does not belong to this store', 404);
}

async function assertProductInStore(storeId: string, productId: string): Promise<void> {
  const product = await prisma.product.findFirst({
    where: { id: productId, storeId, isActive: true },
    select: { id: true },
  });
  if (!product) throw new AppError('Product not found or does not belong to this store', 404);
}

// ─── Inventory list ───────────────────────────────────────────────────────────

export async function getInventory(
  storeId: string,
  branchId: string,
  query: InventoryQuery,
) {
  await assertBranchInStore(storeId, branchId);

  const { search, categoryId, page, limit } = query;

  // Base the list on Product (not InventoryItem) so a brand-new product with
  // no stock record for this branch yet still shows up — with quantity 0 —
  // instead of being invisible until someone finds another way to create its
  // first InventoryItem row. adjustStock() already upserts that row on demand.
  const where: Prisma.ProductWhereInput = {
    storeId,
    isActive: true,
    ...(categoryId && { categoryId }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        imageUrl: true,
        sellingPrice: true,
        costPrice: true,
        taxRate: true,
        category: { select: { id: true, name: true } },
        inventoryItems: {
          where: { branchId },
          select: { id: true, quantity: true, lowStockThreshold: true, updatedAt: true },
        },
      },
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  const items = products.map(({ inventoryItems, ...product }) => {
    const stock = inventoryItems[0];
    const quantity = stock?.quantity ?? 0;
    const lowStockThreshold = stock?.lowStockThreshold ?? 10;
    return {
      // Synthetic id for products never stocked yet — there's no real
      // InventoryItem row to reference; productId is what adjustStock() uses.
      id: stock?.id ?? `unstocked:${product.id}:${branchId}`,
      productId: product.id,
      branchId,
      quantity,
      lowStockThreshold,
      updatedAt: stock?.updatedAt ?? null,
      product,
      isLowStock: quantity <= lowStockThreshold,
    };
  });

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}

// ─── Stock adjustment ─────────────────────────────────────────────────────────

export async function adjustStock(params: {
  storeId: string;
  branchId: string;
  productId: string;
  quantity: number;
  reason: AdjustmentReason;
  note: string;
  userId: string;
}) {
  const { storeId, branchId, productId, quantity, reason, note, userId } = params;

  await assertBranchInStore(storeId, branchId);
  await assertProductInStore(storeId, productId);

  // Upsert ensures the record exists before we touch it.
  // Sequential ops (no interactive tx) — compatible with PgBouncer transaction mode.
  const baseItem = await prisma.inventoryItem.upsert({
    where: { productId_branchId: { productId, branchId } },
    create: { productId, branchId, quantity: 0, lowStockThreshold: 10 },
    update: {},
  });

  let updatedItem;

  if (quantity < 0) {
    // updateMany with stock guard prevents negative inventory under concurrency.
    const result = await prisma.inventoryItem.updateMany({
      where: { productId, branchId, quantity: { gte: -quantity } },
      data: { quantity: { increment: quantity } },
    });
    if (result.count === 0) {
      throw new AppError('Insufficient stock for this adjustment', 400);
    }
    updatedItem = await prisma.inventoryItem.findUnique({
      where: { productId_branchId: { productId, branchId } },
    });
  } else {
    updatedItem = await prisma.inventoryItem.update({
      where: { productId_branchId: { productId, branchId } },
      data: { quantity: { increment: quantity } },
    });
  }

  const movement = await prisma.stockMovement.create({
    data: {
      inventoryItemId: baseItem.id,
      type: StockMovementType.ADJUSTMENT,
      quantity,
      reason,
      note,
      userId,
    },
  });

  return { inventoryItem: updatedItem!, movement };
}

// ─── Stock adjustment — threshold gate + approval workflow ───────────────────
// BRANCH_MANAGER adjustments whose |quantity| exceeds the store's configured
// threshold are held for STORE_ADMIN review instead of applying immediately —
// a large "correction" is exactly the kind of thing that should require a
// second set of eyes. STORE_ADMIN/SUPER_ADMIN adjustments always apply
// immediately regardless of size; they're already the approver.

export async function requestOrApplyAdjustment(params: {
  storeId: string;
  branchId: string;
  productId: string;
  quantity: number;
  reason: AdjustmentReason;
  note: string;
  userId: string;
  role: string;
}): Promise<
  | { pending: true; request: { id: string; quantity: number; reason: AdjustmentReason; note: string } }
  | { pending: false; inventoryItem: unknown; movement: unknown }
> {
  const { storeId, branchId, productId, quantity, reason, note, userId, role } = params;

  if (role === 'BRANCH_MANAGER') {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { stockAdjustmentThreshold: true },
    });
    const threshold = store?.stockAdjustmentThreshold ?? 20;

    if (Math.abs(quantity) > threshold) {
      await assertBranchInStore(storeId, branchId);
      await assertProductInStore(storeId, productId);

      const request = await prisma.stockAdjustmentRequest.create({
        data: { storeId, branchId, productId, quantity, reason, note, requestedById: userId },
      });

      await auditLog({
        storeId,
        userId,
        action: 'REQUEST',
        entity: 'StockAdjustmentRequest',
        entityId: request.id,
        metadata: { productId, branchId, quantity, reason },
      });

      return { pending: true, request };
    }
  }

  const result = await adjustStock({ storeId, branchId, productId, quantity, reason, note, userId });
  return { pending: false, ...result };
}

export async function listAdjustmentRequests(
  storeId: string,
  role: string,
  userBranchId: string | undefined,
  query: ListAdjustmentRequestsQuery,
) {
  const { status, page, limit } = query;

  const where: Prisma.StockAdjustmentRequestWhereInput = {
    storeId,
    ...(role === 'BRANCH_MANAGER' && { branchId: userBranchId }),
    ...(status && { status: status as StockAdjustmentRequestStatus }),
  };

  const [requests, total] = await Promise.all([
    prisma.stockAdjustmentRequest.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true } },
        branch: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.stockAdjustmentRequest.count({ where }),
  ]);

  return { requests, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function reviewAdjustmentRequest(params: {
  storeId: string;
  requestId: string;
  action: 'APPROVE' | 'REJECT';
  reviewNote: string | undefined;
  reviewerId: string;
}) {
  const { storeId, requestId, action, reviewNote, reviewerId } = params;

  const request = await prisma.stockAdjustmentRequest.findFirst({
    where: { id: requestId, storeId },
  });
  if (!request) throw new AppError('Adjustment request not found', 404);
  if (request.status !== StockAdjustmentRequestStatus.PENDING) {
    throw new AppError('This request has already been reviewed', 409);
  }

  if (action === 'REJECT') {
    const updated = await prisma.stockAdjustmentRequest.update({
      where: { id: requestId },
      data: { status: StockAdjustmentRequestStatus.REJECTED, reviewedById: reviewerId, reviewNote },
    });
    await auditLog({
      storeId, userId: reviewerId, action: 'REJECT',
      entity: 'StockAdjustmentRequest', entityId: requestId, metadata: { reviewNote },
    });
    return { request: updated };
  }

  // Approve — perform the actual stock mutation now, then mark approved.
  const result = await adjustStock({
    storeId,
    branchId: request.branchId,
    productId: request.productId,
    quantity: request.quantity,
    reason: request.reason,
    note: request.note,
    userId: request.requestedById,
  });

  const updated = await prisma.stockAdjustmentRequest.update({
    where: { id: requestId },
    data: { status: StockAdjustmentRequestStatus.APPROVED, reviewedById: reviewerId, reviewNote },
  });

  await auditLog({
    storeId, userId: reviewerId, action: 'APPROVE',
    entity: 'StockAdjustmentRequest', entityId: requestId, metadata: { reviewNote },
  });

  return { request: updated, ...result };
}

// ─── Stock transfer ───────────────────────────────────────────────────────────

export async function transferStock(params: {
  storeId: string;
  fromBranchId: string;
  toBranchId: string;
  productId: string;
  quantity: number;
  note: string | undefined;
  userId: string;
}) {
  const { storeId, fromBranchId, toBranchId, productId, quantity, note, userId } = params;

  await Promise.all([
    assertBranchInStore(storeId, fromBranchId),
    assertBranchInStore(storeId, toBranchId),
    assertProductInStore(storeId, productId),
  ]);

  // Pre-fetch source item to get its ID (updateMany doesn't return rows).
  const sourceItem = await prisma.inventoryItem.findUnique({
    where: { productId_branchId: { productId, branchId: fromBranchId } },
  });
  if (!sourceItem || sourceItem.quantity < quantity) {
    throw new AppError('Insufficient stock in the source branch', 400);
  }

  // Deduct from source with concurrency-safe guard (array-form tx — one round-trip).
  const [sourceResult] = await prisma.$transaction([
    prisma.inventoryItem.updateMany({
      where: { productId, branchId: fromBranchId, quantity: { gte: quantity } },
      data: { quantity: { decrement: quantity } },
    }),
  ]);

  if (sourceResult.count === 0) {
    // Another concurrent request consumed the stock between the pre-check and the decrement.
    throw new AppError('Insufficient stock in the source branch', 400);
  }

  // Add to destination (create record if it does not exist yet).
  // Wrapped in try/catch to compensate the source decrement on failure.
  let destItem;
  try {
    destItem = await prisma.inventoryItem.upsert({
      where: { productId_branchId: { productId, branchId: toBranchId } },
      create: { productId, branchId: toBranchId, quantity, lowStockThreshold: 10 },
      update: { quantity: { increment: quantity } },
    });
  } catch (err) {
    // Best-effort compensation: restore source stock.
    await prisma.inventoryItem.updateMany({
      where: { productId, branchId: fromBranchId },
      data: { quantity: { increment: quantity } },
    }).catch(() => {});
    throw err;
  }

  // Create movement records (supplementary audit; best-effort).
  await prisma.stockMovement.createMany({
    data: [
      {
        inventoryItemId: sourceItem.id,
        type: StockMovementType.TRANSFER_OUT,
        quantity: -quantity,
        note: note ?? null,
        userId,
      },
      {
        inventoryItemId: destItem.id,
        type: StockMovementType.TRANSFER_IN,
        quantity,
        note: note ?? null,
        userId,
      },
    ],
  }).catch(() => {});

  return { fromBranchId, toBranchId, productId, quantity };
}

// ─── Movement history ─────────────────────────────────────────────────────────

export async function getMovements(storeId: string, query: MovementsQuery) {
  const { branchId, productId, type, startDate, endDate, page, limit } = query;

  const where: Prisma.StockMovementWhereInput = {
    inventoryItem: {
      branch: { storeId },
      ...(branchId && { branchId }),
      ...(productId && { productId }),
    },
    ...(type && { type }),
    ...((startDate || endDate) && {
      createdAt: {
        ...(startDate && { gte: new Date(startDate) }),
        ...(endDate && { lte: new Date(endDate) }),
      },
    }),
  };

  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      include: {
        inventoryItem: {
          select: {
            product: { select: { id: true, name: true, sku: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.stockMovement.count({ where }),
  ]);

  return { movements, total, page, limit, totalPages: Math.ceil(total / limit) };
}

// ─── Low stock ────────────────────────────────────────────────────────────────

interface LowStockRow {
  id: string;
  productId: string;
  branchId: string;
  quantity: number;
  lowStockThreshold: number;
  productName: string;
  sku: string;
  imageUrl: string | null;
  branchName: string;
}

export async function getLowStockItems(
  storeId: string,
  branchId?: string,
): Promise<LowStockRow[]> {
  const branchFilter = branchId
    ? Prisma.sql`AND ii."branchId" = ${branchId}`
    : Prisma.empty;

  return prisma.$queryRaw<LowStockRow[]>`
    SELECT
      ii.id,
      ii."productId",
      ii."branchId",
      ii.quantity,
      ii."lowStockThreshold",
      p.name                 AS "productName",
      p.sku,
      p."imageUrl",
      b.name                 AS "branchName"
    FROM inventory_items ii
    JOIN products  p ON p.id = ii."productId"
    JOIN branches  b ON b.id = ii."branchId"
    WHERE b."storeId" = ${storeId}
    ${branchFilter}
      AND p."isActive" = true
      AND ii.quantity <= ii."lowStockThreshold"
    ORDER BY ii.quantity ASC, p.name ASC
  `;
}

// ─── Stock discrepancies ──────────────────────────────────────────────────────
// Lists items whose quantity is negative (caused by offline sales) plus the
// offline orders that triggered those discrepancies.

export async function getDiscrepancies(storeId: string, branchId?: string) {
  const negativeItems = await prisma.inventoryItem.findMany({
    where: {
      quantity: { lt: 0 },
      branch: { storeId },
      ...(branchId && { branchId }),
    },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      branch: { select: { id: true, name: true } },
    },
    orderBy: { quantity: 'asc' },
  });

  const offlineOrders = await prisma.order.findMany({
    where: {
      storeId,
      stockDiscrepancy: true,
      ...(branchId && { branchId }),
    },
    select: {
      id: true,
      orderNumber: true,
      offlineReference: true,
      createdAtClient: true,
      createdAt: true,
      branchId: true,
      grandTotal: true,
      items: {
        select: { productId: true, productName: true, quantity: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    negativeStockItems: negativeItems.map((item) => ({
      inventoryItemId: item.id,
      productId: item.product.id,
      productName: item.product.name,
      sku: item.product.sku,
      branchId: item.branch.id,
      branchName: item.branch.name,
      currentQuantity: item.quantity,
      deficit: Math.abs(item.quantity),
    })),
    offlineOrders: offlineOrders.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      offlineReference: o.offlineReference,
      branchId: o.branchId,
      saleTimestamp: o.createdAtClient ?? o.createdAt,
      syncedAt: o.createdAt,
      grandTotal: Number(o.grandTotal),
      items: o.items,
    })),
  };
}

// ─── Audit wrapper ────────────────────────────────────────────────────────────

export async function logInventoryAudit(params: {
  storeId: string;
  userId: string;
  action: string;
  productId: string;
  branchId: string;
  metadata?: Record<string, unknown>;
}) {
  return auditLog({
    storeId: params.storeId,
    userId: params.userId,
    action: params.action,
    entity: 'InventoryItem',
    entityId: `${params.productId}:${params.branchId}`,
    metadata: params.metadata,
  });
}
