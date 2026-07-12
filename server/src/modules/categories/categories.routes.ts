import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { tenantScope } from '../../middleware/tenant';
import { validate } from '../../middleware/validate';
import { createCategorySchema, updateCategorySchema } from './categories.schema';
import * as categoriesController from './categories.controller';

export const categoriesRouter = Router();

categoriesRouter.use(authenticate, tenantScope);

// STORE_ADMIN and BRANCH_MANAGER can read
categoriesRouter.get(
  '/',
  authorize('STORE_ADMIN', 'BRANCH_MANAGER', 'SUPER_ADMIN'),
  categoriesController.getCategories,
);
categoriesRouter.get(
  '/:id',
  authorize('STORE_ADMIN', 'BRANCH_MANAGER', 'SUPER_ADMIN'),
  categoriesController.getCategory,
);

// Mutations: STORE_ADMIN only
categoriesRouter.post(
  '/',
  authorize('STORE_ADMIN', 'SUPER_ADMIN'),
  validate(createCategorySchema),
  categoriesController.createCategory,
);
categoriesRouter.patch(
  '/:id',
  authorize('STORE_ADMIN', 'SUPER_ADMIN'),
  validate(updateCategorySchema),
  categoriesController.updateCategory,
);
categoriesRouter.delete(
  '/:id',
  authorize('STORE_ADMIN', 'SUPER_ADMIN'),
  categoriesController.deleteCategory,
);
