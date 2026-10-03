import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { tenantScope } from '../../middleware/tenant';
import { validate } from '../../middleware/validate';
import { upload } from '../../middleware/upload';
import { updateStoreSchema, receiptSettingsSchema, createAuditEntrySchema } from './store.schema';
import * as storeController from './store.controller';

export const storeRouter = Router();

// Audit endpoint — any authenticated role (cashiers log drawer events)
storeRouter.post(
  '/audit',
  authenticate,
  authorize('SUPER_ADMIN', 'STORE_ADMIN', 'BRANCH_MANAGER', 'CASHIER'),
  tenantScope,
  validate(createAuditEntrySchema),
  storeController.createAuditEntry,
);

// Receipt settings read — any authenticated role (cashiers need this to print)
storeRouter.get(
  '/receipt-settings',
  authenticate,
  authorize('SUPER_ADMIN', 'STORE_ADMIN', 'BRANCH_MANAGER', 'CASHIER'),
  tenantScope,
  storeController.getReceiptSettings,
);

storeRouter.use(authenticate, authorize('STORE_ADMIN', 'SUPER_ADMIN'), tenantScope);

storeRouter.get('/', storeController.getStore);
storeRouter.patch('/', validate(updateStoreSchema), storeController.updateStore);
storeRouter.post('/logo', upload.single('logo'), storeController.uploadLogo);
storeRouter.put('/receipt-settings', validate(receiptSettingsSchema), storeController.updateReceiptSettings);
