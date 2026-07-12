import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { tenantScope } from '../../middleware/tenant';
import { validate } from '../../middleware/validate';
import { createBranchSchema, updateBranchSchema } from './branches.schema';
import * as branchController from './branches.controller';

export const branchesRouter = Router();

// Read-only: all authenticated roles need branch list (e.g. cashier branch selector)
branchesRouter.get(
  '/',
  authenticate,
  authorize('SUPER_ADMIN', 'STORE_ADMIN', 'BRANCH_MANAGER', 'CASHIER'),
  tenantScope,
  branchController.getBranches,
);
branchesRouter.get(
  '/:id',
  authenticate,
  authorize('SUPER_ADMIN', 'STORE_ADMIN', 'BRANCH_MANAGER', 'CASHIER'),
  tenantScope,
  branchController.getBranch,
);

// Mutations: STORE_ADMIN / SUPER_ADMIN only
branchesRouter.use(authenticate, authorize('STORE_ADMIN', 'SUPER_ADMIN'), tenantScope);

branchesRouter.post('/', validate(createBranchSchema), branchController.createBranch);
branchesRouter.patch('/:id', validate(updateBranchSchema), branchController.updateBranch);
branchesRouter.delete('/:id', branchController.deleteBranch);
