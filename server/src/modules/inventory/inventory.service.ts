import { Prisma, StockMovementType } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error';
import { auditLog } from '../../utils/audit';
import type { InventoryQuery, MovementsQuery } from './inventory.schema';

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
  note: string;
  userId: string;
}) {
  const { storeId, branchId, productId, quantity, note, userId } = params;

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
      note,
      userId,
    },
  });

  return { inventoryItem: updatedItem!, movement };
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
