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

  const where: Prisma.InventoryItemWhereInput = {
    branchId,
    product: {
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
    },
  };

  const [items, total] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      include: {
        product: {
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
          },
        },
      },
      orderBy: { product: { name: 'asc' } },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.inventoryItem.count({ where }),
  ]);

  const enriched = items.map((item) => ({
    ...item,
    isLowStock: item.quantity <= item.lowStockThreshold,
  }));

  return { items: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
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

  return prisma.$transaction(async (tx) => {
    // Upsert inventory item so adjustments on new products create the record
    await tx.inventoryItem.upsert({
      where: { productId_branchId: { productId, branchId } },
      create: { productId, branchId, quantity: 0, lowStockThreshold: 10 },
      update: {},
    });

    let updatedItem;

    if (quantity < 0) {
      // Atomic guard: only decrement if there is sufficient stock.
      // updateMany returns count=0 if the WHERE condition (quantity >= |delta|) is not met,
      // which prevents negative stock even under concurrent requests.
      const result = await tx.inventoryItem.updateMany({
        where: { productId, branchId, quantity: { gte: -quantity } },
        data: { quantity: { increment: quantity } },
      });
      if (result.count === 0) {
        throw new AppError('Insufficient stock for this adjustment', 400);
      }
      updatedItem = await tx.inventoryItem.findUnique({
        where: { productId_branchId: { productId, branchId } },
      });
    } else {
      updatedItem = await tx.inventoryItem.update({
        where: { productId_branchId: { productId, branchId } },
        data: { quantity: { increment: quantity } },
      });
    }

    const movement = await tx.stockMovement.create({
      data: {
        inventoryItemId: updatedItem!.id,
        type: StockMovementType.ADJUSTMENT,
        quantity,
        note,
        userId,
      },
    });

    return { inventoryItem: updatedItem!, movement };
  });
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

  return prisma.$transaction(async (tx) => {
    // Deduct from source with concurrency-safe guard
    const sourceUpdate = await tx.inventoryItem.updateMany({
      where: { productId, branchId: fromBranchId, quantity: { gte: quantity } },
      data: { quantity: { decrement: quantity } },
    });

    if (sourceUpdate.count === 0) {
      throw new AppError('Insufficient stock in the source branch', 400);
    }

    const sourceItem = await tx.inventoryItem.findUnique({
      where: { productId_branchId: { productId, branchId: fromBranchId } },
    });

    // Add to destination (create record if it does not exist yet)
    const destItem = await tx.inventoryItem.upsert({
      where: { productId_branchId: { productId, branchId: toBranchId } },
      create: { productId, branchId: toBranchId, quantity, lowStockThreshold: 10 },
      update: { quantity: { increment: quantity } },
    });

    // Movements: TRANSFER_OUT stores a negative delta, TRANSFER_IN positive
    await tx.stockMovement.createMany({
      data: [
        {
          inventoryItemId: sourceItem!.id,
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
    });

    return { fromBranchId, toBranchId, productId, quantity };
  });
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
