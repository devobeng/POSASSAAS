import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { tenantScope, branchScope } from '../../middleware/tenant';
import { validate } from '../../middleware/validate';
import {
  createUserSchema,
  updateUserSchema,
  getUsersQuerySchema,
  changePasswordSchema,
} from './users.schema';
import * as usersController from './users.controller';

export const usersRouter = Router();

// Any authenticated user can change their own password
usersRouter.patch(
  '/me/password',
  authenticate,
  validate(changePasswordSchema),
  usersController.changePassword,
);

// User management requires STORE_ADMIN or BRANCH_MANAGER
usersRouter.use(
  authenticate,
  authorize('STORE_ADMIN', 'BRANCH_MANAGER'),
  tenantScope,
  branchScope,
);

usersRouter.get('/', validate(getUsersQuerySchema, 'query'), usersController.getUsers);
usersRouter.get('/:id', usersController.getUser);
usersRouter.post('/', validate(createUserSchema), usersController.createUser);
usersRouter.patch('/:id', validate(updateUserSchema), usersController.updateUser);
usersRouter.delete('/:id', usersController.deactivateUser);
