import type { Request, Response } from 'express';
import * as usersService from './users.service';
import { sendSuccess } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import type { CreateUserInput, UpdateUserInput, GetUsersQuery } from './users.schema';

export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const result = await usersService.getUsers(
    req.storeId!,
    req.user!,
    req.query as unknown as GetUsersQuery,
  );
  sendSuccess(res, result.users, 'Users fetched', 200, result.meta);
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.getUser(req.storeId!, req.params.id);
  sendSuccess(res, user);
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const result = await usersService.createUser(
    req.storeId!,
    req.body as CreateUserInput,
    req.user!,
  );
  sendSuccess(res, result, 'User created — share the temporary password with them', 201);
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.updateUser(
    req.storeId!,
    req.params.id,
    req.body as UpdateUserInput,
    req.user!,
  );
  sendSuccess(res, user, 'User updated');
});

export const deactivateUser = asyncHandler(async (req: Request, res: Response) => {
  await usersService.deactivateUser(req.storeId!, req.params.id, req.user!);
  sendSuccess(res, null, 'User deactivated');
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };
  await usersService.changePassword(req.user!.sub, currentPassword, newPassword);
  sendSuccess(res, null, 'Password changed successfully');
});
