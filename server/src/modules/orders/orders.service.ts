import { Prisma, OrderStatus, PaymentStatus, StockMovementType } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error';
import { auditLog } from '../../utils/audit';
import type { CreateOrderInput, OrderListQuery } from './orders.schema';

// ─── Shared type ─────────────────────────────────────────────────────────────

type OrderWithDetails = Prisma.OrderGetPayload<{
  include: { items: true; payments: true };
}>;

// ─── Create order ─────────────────────────────────────────────────────────────
// Uses NO interactive (callback-form) Prisma transactions so it is compatible
// with PgBouncer in transaction mode.
//
// Online orders:
//   Inventory decrements use prisma.$transaction([]) — the array/batch form
//   which sends BEGIN…COMMIT in one round-trip PgBouncer can handle.
//
// Offline orders:
//   Inventory upserts run sequentially (need the returned ID for movements).

export interface CreateOrderResult {
  order: OrderWithDetails;
  duplicate: boolean;
}

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

  // ── 1. Fetch & validate products ─────────────────────────────────────────────
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

  // ── 2. Server-compute totals ─────────────────────────────────────────────────
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

  // ── 3. Validate payment sum ──────────────────────────────────────────────────
  const paymentSum = payments.reduce((acc, p) => acc + p.amount, 0);
  if (Math.abs(Math.round(paymentSum) - Math.round(grandTotal)) > 1) {
    throw new AppError(
      `Payment total (${paymentSum}) does not match order total (${grandTotal})`,
      400,
    );
  }

  // ── 4. Parallel reads: branch + current inventory ────────────────────────────
  const [branch, existingInventory] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } }),
    prisma.inventoryItem.findMany({
      where: { branchId, productId: { in: productIds } },
      select: { id: true, productId: true, quantity: true },
    }),
  ]);
  if (!branch) throw new AppError('Branch not found', 404);

  const invMap = new Map(existingInventory.map((ii) => [ii.productId, ii]));

  // ── 5. Pre-validate stock (online orders only) ───────────────────────────────
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

  // ── 6. Generate order number ─────────────────────────────────────────────────
  // Atomic UPDATE...RETURNING on Branch.nextOrderSeq — NOT count()-then-increment.
  // Two cashiers checking out at the same branch within the same millisecond
  // would both read the same count and collide on the unique orderNumber index,
  // failing one of their (legitimate, in-stock) sales outright. The DB row lock
  // on this single-row UPDATE serializes concurrent callers correctly.
  const prefix = branch.name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3)
    .padEnd(3, 'X');
  const [{ nextOrderSeq }] = await prisma.$queryRaw<{ nextOrderSeq: number }[]>`
    UPDATE branches SET "nextOrderSeq" = "nextOrderSeq" + 1 WHERE id = ${branchId} RETURNING "nextOrderSeq"
  `;
  const orderNumber = `${prefix}-${String(nextOrderSeq).padStart(6, '0')}`;

  const hasPaystack = payments.some((p) => p.method === 'PAYSTACK');
  const orderStatus: OrderStatus = hasPaystack ? OrderStatus.PENDING : OrderStatus.COMPLETED;

  // ── 7. Inventory updates ─────────────────────────────────────────────────────
  let stockDiscrepancy = false;
  // Maps productId → inventoryItem.id (needed for stock movement records)
  const finalInvIds = new Map<string, string>(
    existingInventory.map((ii) => [ii.productId, ii.id]),
  );

  if (isOffline) {
    // Unconditional upsert per item — allows negative stock.
    // Sequential because we need each upsert's returned record for the ID.
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
    // Batch-decrement with per-item stock guards.
    // prisma.$transaction([...]) array form sends BEGIN/ops/COMMIT in one
    // round-trip — fully compatible with PgBouncer transaction mode.
    const stockResults = await prisma.$transaction(
      items.map((item) =>
        prisma.inventoryItem.updateMany({
          where: { productId: item.productId, branchId, quantity: { gte: item.quantity } },
          data: { quantity: { decrement: item.quantity } },
        }),
      ),
    );

    for (let i = 0; i < stockResults.length; i++) {
      if (stockResults[i].count === 0) {
        // Re-increment any items successfully decremented before this one.
        const toRestore = items.slice(0, i);
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
        throw new AppError(
          `Insufficient stock for "${productMap.get(items[i].productId)!.name}" (requested ${items[i].quantity})`,
          400,
        );
      }
    }
  }

  // ── 8. Build stock-movement payload ─────────────────────────────────────────
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

  // ── 9. Create order (single atomic Prisma write) ─────────────────────────────
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
    // Lost the idempotency race: another request with the same clientOrderId
    // committed its order between our findFirst check (step 0) and this
    // insert — the (storeId, clientOrderId) unique constraint rejects us with
    // P2002. We already decremented stock above as if our order would win;
    // since it didn't, restore it, then hand back the winner's order.
    if (
      clientOrderId &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
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

      const existing = await prisma.order.findFirst({
        where: { storeId, clientOrderId },
        include: { items: true, payments: true },
      });
      if (existing) return { order: existing, duplicate: true };
    }
    throw err;
  }

  // ── 10. Stock movements (supplementary audit; best-effort) ───────────────────
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
// Inventory upserts run sequentially (need the returned ID for movements),
// then movements + order-status update run in one array-form transaction.

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

  const refundableItems = order.items.filter((i) => i.productId);

  // Step 1: Upsert inventory items sequentially to collect their IDs.
  const invIdMap = new Map<string, string>();
  for (const item of refundableItems) {
    const inv = await prisma.inventoryItem.upsert({
      where: { productId_branchId: { productId: item.productId!, branchId: order.branchId } },
      update: { quantity: { increment: item.quantity } },
      create: {
        productId: item.productId!,
        branchId: order.branchId,
        quantity: item.quantity,
        lowStockThreshold: 5,
      },
    });
    invIdMap.set(item.productId!, inv.id);
  }

  // Step 2: Movements + order-status update in one array-form transaction.
  const movementOps = refundableItems
    .filter((i) => invIdMap.has(i.productId!))
    .map((item) =>
      prisma.stockMovement.create({
        data: {
          inventoryItemId: invIdMap.get(item.productId!)!,
          type: StockMovementType.RETURN,
          quantity: item.quantity,
          note: `Refund for order ${order.orderNumber}`,
          userId,
        },
      }),
    );

  const orderUpdateOp = prisma.order.update({
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

  const results = await prisma.$transaction([...movementOps, orderUpdateOp]);
  const refunded = results[results.length - 1] as OrderWithDetails;

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
