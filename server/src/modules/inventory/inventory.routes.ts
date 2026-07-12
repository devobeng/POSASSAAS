import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { tenantScope } from '../../middleware/tenant';
import { validate } from '../../middleware/validate';
import {
  adjustStockSchema,
  transferStockSchema,
  inventoryQuerySchema,
  movementsQuerySchema,
  lowStockQuerySchema,
} from './inventory.schema';
import * as inventoryController from './inventory.controller';

export const inventoryRouter = Router();

inventoryRouter.use(
  authenticate,
  authorize('STORE_ADMIN', 'BRANCH_MANAGER', 'SUPER_ADMIN'),
  tenantScope,
);

inventoryRouter.get(
  '/',
  validate(inventoryQuerySchema, 'query'),
  inventoryController.getInventory,
);

inventoryRouter.post(
  '/adjust',
  validate(adjustStockSchema),
  inventoryController.adjustStock,
);

inventoryRouter.post(
  '/transfer',
  validate(transferStockSchema),
  inventoryController.transferStock,
);

inventoryRouter.get(
  '/movements',
  validate(movementsQuerySchema, 'query'),
  inventoryController.getMovements,
);

inventoryRouter.get(
  '/low-stock',
  validate(lowStockQuerySchema, 'query'),
  inventoryController.getLowStock,
);

inventoryRouter.get('/discrepancies', inventoryController.getDiscrepancies);
