import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { tenantScope } from '../../middleware/tenant';
import * as syncController from './sync.controller';

export const syncRouter = Router();

// All sync endpoints require auth + tenant scope
syncRouter.use(authenticate, tenantScope);

// Catalog: read-only, all authenticated roles
syncRouter.get('/catalog', syncController.getCatalog);

// Batch order sync: CASHIER only (same as single order creation)
syncRouter.post(
  '/orders',
  authorize('CASHIER'),
  syncController.batchSync,
);
