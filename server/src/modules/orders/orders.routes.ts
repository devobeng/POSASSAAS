import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import * as ordersController from './orders.controller';

export const ordersRouter = Router();

ordersRouter.use(authenticate);

// Create — CASHIER only (branchId always from JWT)
ordersRouter.post('/', authorize('CASHIER'), ordersController.createOrder);

// List — all roles (visibility is scoped inside the service)
ordersRouter.get(
  '/',
  authorize('CASHIER', 'BRANCH_MANAGER', 'STORE_ADMIN', 'SUPER_ADMIN'),
  ordersController.listOrders,
);

// Single order
ordersRouter.get(
  '/:id',
  authorize('CASHIER', 'BRANCH_MANAGER', 'STORE_ADMIN', 'SUPER_ADMIN'),
  ordersController.getOrder,
);

// Refund — BRANCH_MANAGER and above
ordersRouter.post(
  '/:id/refund',
  authorize('BRANCH_MANAGER', 'STORE_ADMIN', 'SUPER_ADMIN'),
  ordersController.refundOrder,
);

// Receipt — all roles (service enforces visibility)
ordersRouter.get(
  '/:id/receipt',
  authorize('CASHIER', 'BRANCH_MANAGER', 'STORE_ADMIN', 'SUPER_ADMIN'),
  ordersController.getReceipt,
);
