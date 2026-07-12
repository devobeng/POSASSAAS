import { Prisma, OrderStatus, PaymentStatus, StockMovementType } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error';
import { auditLog } from '../../utils/audit';
import type { CreateOrderInput, OrderListQuery } from './orders.schema';

// ─── Shared type ──────────────────────────────────────────────────────────────

type OrderWithDetails = Prisma.OrderGetPayload<{
  include: { items: true; payments: true };
}>;

export interface CreateOrderResult {
  order: OrderWithDetails;
  duplicate: boolean;
}

// ─── Create order ─────────────────────────────────────────────────────────────
//
// PgBouncer transaction-mode (port 6543) cannot support Prisma's interactive
// $transaction(async tx => {...}) API because PgBouncer recycles the connection
// between async awaits, losing the transaction context (P2028).
//
// Strategy:
//  1. All reads happen outside any transaction.
//  2. Online stock decrements use the ARRAY-form $transaction([updateMany, ...])
//     which sends BEGIN + queries + COMMIT in a single network round-trip — safe
//     with PgBouncer transaction mode.
//  3. order.create (with nested items + payments) is a single atomic Prisma op.
//  4. stockMovement.createMany is a supplementary audit write; best-effort.
//  5. On partial failure (stock decremented but order.create throws) the handler
//     re-increments stock as a compensating write.

export async function createOrder(
  storeId: string,
  cashierId: string,
  branchId: string,
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const { items, discount, payments, clientOrderId, createdAtClient, offlineReference } = input;
  const isOffline = Boolean(clientOrderId);

  // ── Idempotency ──────────────────────────────────────────────────────────────
  if (clientOrderId) {
    const existing = await prisma.order.findFirst({
      where: { storeId, clientOrderId },
      include: { items: true, payments: true },
    });
    if (existing) return { order: existing, duplicate: true };
  }

  // ── 1. Fetch + validate products ─────────────────────────────────────────────
  const productIds = items.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, storeId, isActive: true },
  });

  if (products.length !== productIds.length) {
    const found = new Set(products.map((p) => p.id));
    const missing = productIds.filter((id) => !found.has(id));
    throw new AppError(`Products not found or inactive: ${missing.join(', ')}`, 404);
  }

  const productMap = new Map(products.map((p) => [p.id, p]));

  // ── 2. Server-compute totals — never trust client ────────────────────────────
  let subtotal = 0;
  let taxTotal = 0;

  const lineItems = items.map((item) => {
    const product = productMap.get(item.productId)!;
    const unitPrice = Number(product.sellingPrice);
    const taxRate = Number(product.taxRate);
    const lineSubtotal = unitPrice * item.quantity;
    const lineTax = Math.round(lineSubtotal * (taxRate / 100));
    subtotal += lineSubtotal;
    taxTotal += lineTax;
    return {
      productId: product.id,
      productName: product.name,
      unitPrice: new Prisma.Decimal(unitPrice),
      quantity: item.quantity,
      lineTotal: new Prisma.Decimal(lineSubtotal + lineTax),
    };
  });

  const discountAmount = discount ?? 0;
  const grandTotal = Math.max(0, subtotal + taxTotal - discountAmount);

  // ── 3. Validate payment sum ───────────────────────────────────────────────────
  const paymentSum = payments.reduce((acc, p) => acc + p.amount, 0);
  if (Math.abs(Math.round(paymentSum) - Math.round(grandTotal)) > 1) {
    throw new AppError(
      `Payment total (${paymentSum}) does not match order total (${grandTotal})`,
      400,
    );
  }

  // ── 4. Fetch branch + existing inventory (parallel) ──────────────────────────
  const [branch, existingInventory] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } }),
    prisma.inventoryItem.findMany({
      where: { branchId, productId: { in: productIds } },
      select: { id: true, productId: true, quantity: true },
    }),
  ]);
  if (!branch) throw new AppError('Branch not found', 404);

  const invMap = new Map(existingInventory.map((ii) => [ii.productId, ii]));

  // ── 5. Pre-validate stock (online orders only) ────────────────────────────────
  if (!isOffline) {
    for (const item of items) {
      const inv = invMap.get(item.productId);
      const available = inv ? Number(inv.quantity) : 0;
      if (available < item.quantity) {
        throw new AppError(
          `Insufficient stock for "${productMap.get(item.productId)!.name}" (requested ${item.quantity}, available ${available})`,
          400,
        );
      }
    }
  }

  // ── 6. Generate order number ──────────────────────────────────────────────────
  const prefix = branch.name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3)
    .padEnd(3, 'X');
  const orderCount = await prisma.order.count({ where: { branchId } });
  const orderNumber = `${prefix}-${String(orderCount + 1).padStart(6, '0')}`;

  const hasPaystack = payments.some((p) => p.method === 'PAYSTACK');
  const orderStatus: OrderStatus = hasPaystack ? OrderStatus.PENDING : OrderStatus.COMPLETED;

  // ── 7. Inventory updates ──────────────────────────────────────────────────────
  let stockDiscrepancy = false;
  // Maps productId → inventoryItemId (needed for movements)
  const finalInvIds = new Map(existingInventory.map((ii) => [ii.productId, ii.id]));

  if (isOffline) {
    // Unconditional upsert — allows negative stock for items sold offline.
    // The upsert result carries the post-decrement quantity for discrepancy detection.
    for (const item of items) {
      const inv = await prisma.inventoryItem.upsert({
        where: { productId_branchId: { productId: item.productId, branchId } },
        update: { quantity: { decrement: item.quantity } },
        create: {
          productId: item.productId,
          branchId,
          quantity: -item.quantity,
          lowStockThreshold: 10,
        },
      });
      if (Number(inv.quantity) < 0) stockDiscrepancy = true;
      finalInvIds.set(item.productId, inv.id);
    }
  } else {
    // Array-form $transaction: sends BEGIN + all updateMany + COMMIT in one
    // round-trip. Safe with PgBouncer transaction mode (no connection released
    // between the statements of the same SQL transaction).
    const stockOps = items.map((item) =>
      prisma.inventoryItem.updateMany({
        where: { productId: item.productId, branchId, quantity: { gte: item.quantity } },
        data: { quantity: { decrement: item.quantity } },
      }),
    );
    const stockResults = await prisma.$transaction(stockOps);

    // Check guards — if any returned count=0, compensate and reject.
    const failIdx = stockResults.findIndex((r) => r.count === 0);
    if (failIdx !== -1) {
      const toRestore = items.slice(0, failIdx);
      if (toRestore.length > 0) {
        await prisma
          .$transaction(
            toRestore.map((item) =>
              prisma.inventoryItem.updateMany({
                where: { productId: item.productId, branchId },
                data: { quantity: { increment: item.quantity } },
              }),
            ),
          )
          .catch(() => {});
      }
      const p = productMap.get(items[failIdx].productId)!;
      throw new AppError(
        `Insufficient stock for "${p.name}" (requested ${items[failIdx].quantity})`,
        400,
      );
    }
  }

  // ── 8. Build stock movement data ─────────────────────────────────────────────
  const movementData = items
    .map((item) => {
      const inventoryItemId = finalInvIds.get(item.productId);
      if (!inventoryItemId) return null;
      return {
        inventoryItemId,
        type: StockMovementType.SALE,
        quantity: -item.quantity,
        note: `Order ${orderNumber}${offlineReference ? ` (offline: ${offlineReference})` : ''}`,
        userId: cashierId,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  // ── 9. Create order (atomic single Prisma op: order + items + payments) ───────
  let order: OrderWithDetails;
  try {
    order = await prisma.order.create({
      data: {
        orderNumber,
        storeId,
        branchId,
        cashierId,
        status: orderStatus,
        subtotal: new Prisma.Decimal(subtotal),
        taxTotal: new Prisma.Decimal(taxTotal),
        discountTotal: new Prisma.Decimal(discountAmount),
        grandTotal: new Prisma.Decimal(grandTotal),
        ...(clientOrderId && { clientOrderId }),
        ...(createdAtClient && { createdAtClient: new Date(createdAtClient) }),
        ...(offlineReference && { offlineReference }),
        stockDiscrepancy,
        items: { createMany: { data: lineItems } },
        payments: {
          createMany: {
            data: payments.map((p) => ({
              method: p.method,
              amount: new Prisma.Decimal(p.amount),
              status: p.method === 'PAYSTACK' ? PaymentStatus.PENDING : PaymentStatus.SUCCESS,
            })),
          },
        },
      },
      include: { items: true, payments: true },
    });
  } catch (err) {
    // Compensate: re-increment inventory that was decremented in step 7.
    if (!isOffline && items.length > 0) {
      await prisma
        .$transaction(
          items.map((item) =>
            prisma.inventoryItem.updateMany({
              where: { productId: item.productId, branchId },
              data: { quantity: { increment: item.quantity } },
            }),
          ),
        )
        .catch(() => {});
    }
    throw err;
  }

  // ── 10. Stock movements (supplementary audit — best-effort) ───────────────────
  if (movementData.length > 0) {
    await prisma.stockMovement.createMany({ data: movementData }).catch(() => {});
  }

  return { order, duplicate: false };
}

// ─── List orders ──────────────────────────────────────────────────────────────

export async function getOrders(
  role: string,
  userId: string,
  storeId: string | undefined,
  userBranchId: string | undefined,
  query: OrderListQuery,
) {
  const { branchId, cashierId, status, startDate, endDate, page, limit } = query;

  const where: Prisma.OrderWhereInput = {};

  if (storeId) where.storeId = storeId;

  if (role === 'CASHIER') {
    where.cashierId = userId;
  } else if (role === 'BRANCH_MANAGER') {
    where.branchId = userBranchId;
  } else {
    if (branchId) where.branchId = branchId;
    if (cashierId) where.cashierId = cashierId;
  }

  if (status) where.status = status as OrderStatus;

  if (startDate || endDate) {
    where.createdAt = {
      ...(startDate && { gte: new Date(startDate) }),
      ...(endDate && {
        lte: /^\d{4}-\d{2}-\d{2}$/.test(endDate)
          ? new Date(new Date(endDate).getTime() + 86400000)
          : new Date(endDate),
      }),
    };
  }

  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        items: true,
        payments: true,
        cashier: { select: { id: true, name: true, email: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total, page, limit, totalPages: Math.ceil(total / limit) };
}

// ─── Get single order ─────────────────────────────────────────────────────────

export async function getOrder(
  role: string,
  userId: string,
  storeId: string | undefined,
  userBranchId: string | undefined,
  orderId: string,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      payments: true,
      cashier: { select: { id: true, name: true, email: true } },
      branch: { select: { id: true, name: true } },
      store: { select: { id: true, name: true, currency: true } },
    },
  });

  if (!order) throw new AppError('Order not found', 404);
  if (storeId && order.storeId !== storeId) throw new AppError('Order not found', 404);

  if (role === 'CASHIER' && order.cashierId !== userId) {
    throw new AppError('Order not found', 404);
  }
  if (role === 'BRANCH_MANAGER' && order.branchId !== userBranchId) {
    throw new AppError('Order not found', 404);
  }

  return order;
}

// ─── Refund order ─────────────────────────────────────────────────────────────
//
// Same PgBouncer constraint as createOrder — avoids interactive transactions.
// Flow:
//  1. Pre-fetch inventory item IDs (needed for movement records).
//  2. For each order item: upsert inventory (increment stock).
//  3. Create RETURN stock movements.
//  4. Update order status to REFUNDED + create refund payment record.

export async function refundOrder(
  storeId: string,
  userBranchId: string | undefined,
  role: string,
  userId: string,
  orderId: string,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) throw new AppError('Order not found', 404);
  if (storeId && order.storeId !== storeId) throw new AppError('Order not found', 404);

  if (role === 'BRANCH_MANAGER' && order.branchId !== userBranchId) {
    throw new AppError('You can only refund orders from your own branch', 403);
  }

  if (order.status === OrderStatus.REFUNDED) {
    throw new AppError('Order is already refunded', 409);
  }
  if (order.status !== OrderStatus.COMPLETED) {
    throw new AppError('Only completed orders can be refunded', 400);
  }

  const refundableItems = order.items.filter((item) => item.productId !== null);

  // ── Pre-fetch inventory IDs for movement records ───────────────────────────
  const productIds = refundableItems.map((i) => i.productId as string);
  const existingInv = await prisma.inventoryItem.findMany({
    where: { branchId: order.branchId, productId: { in: productIds } },
    select: { id: true, productId: true },
  });
  const invIdMap = new Map(existingInv.map((ii) => [ii.productId, ii.id]));

  // ── Re-stock each item (upsert in case record didn't exist) ────────────────
  for (const item of refundableItems) {
    const inv = await prisma.inventoryItem.upsert({
      where: {
        productId_branchId: { productId: item.productId as string, branchId: order.branchId },
      },
      update: { quantity: { increment: item.quantity } },
      create: {
        productId: item.productId as string,
        branchId: order.branchId,
        quantity: item.quantity,
        lowStockThreshold: 5,
      },
    });
    // Capture ID for items that were just created
    invIdMap.set(item.productId as string, inv.id);
  }

  // ── RETURN stock movements ─────────────────────────────────────────────────
  for (const item of refundableItems) {
    const inventoryItemId = invIdMap.get(item.productId as string);
    if (!inventoryItemId) continue;
    await prisma.stockMovement.create({
      data: {
        inventoryItemId,
        type: StockMovementType.RETURN,
        quantity: item.quantity,
        note: `Refund for order ${order.orderNumber}`,
        userId,
      },
    });
  }

  // ── Update order status + refund payment ──────────────────────────────────
  const refunded = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.REFUNDED,
      payments: {
        create: {
          method: 'CASH',
          amount: order.grandTotal,
          status: PaymentStatus.REFUNDED,
        },
      },
    },
    include: { items: true, payments: true },
  });

  await auditLog({
    storeId,
    userId,
    action: 'REFUND',
    entity: 'Order',
    entityId: orderId,
    metadata: { orderNumber: order.orderNumber, grandTotal: Number(order.grandTotal) },
  });

  return refunded;
}

// ─── Receipt payload ──────────────────────────────────────────────────────────

export async function getReceipt(
  storeId: string,
  userBranchId: string | undefined,
  role: string,
  userId: string,
  orderId: string,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      payments: true,
      cashier: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true, address: true, phone: true } },
      store: { select: { id: true, name: true, logoUrl: true, currency: true } },
    },
  });

  if (!order) throw new AppError('Order not found', 404);
  if (storeId && order.storeId !== storeId) throw new AppError('Order not found', 404);

  if (role === 'CASHIER' && order.cashierId !== userId) throw new AppError('Order not found', 404);
  if (role === 'BRANCH_MANAGER' && order.branchId !== userBranchId) {
    throw new AppError('Order not found', 404);
  }

  return {
    store: order.store,
    branch: order.branch,
    cashier: order.cashier,
    orderNumber: order.orderNumber,
    offlineReference: order.offlineReference ?? null,
    status: order.status,
    createdAt: order.createdAtClient ?? order.createdAt,
    syncedAt: order.createdAtClient ? order.createdAt : null,
    items: order.items.map((i) => ({
      productName: i.productName,
      quantity: i.quantity,
      unitPrice: Number(i.unitPrice),
      lineTotal: Number(i.lineTotal),
    })),
    subtotal: Number(order.subtotal),
    taxTotal: Number(order.taxTotal),
    discountTotal: Number(order.discountTotal),
    grandTotal: Number(order.grandTotal),
    payments: order.payments.map((p) => ({
      method: p.method,
      amount: Number(p.amount),
      status: p.status,
    })),
  };
}
