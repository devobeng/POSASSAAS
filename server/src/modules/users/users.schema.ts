import { z } from 'zod';
import { isValidPhone } from '../../utils/phone';

const phoneSchema = z.string().refine(isValidPhone, 'Enter a valid phone number');

export const createUserSchema = z.object({
  phone: phoneSchema,
  email: z.string().email().optional(),
  name: z.string().min(2).max(100),
  role: z.enum(['BRANCH_MANAGER', 'CASHIER']),
  branchId: z.string().optional(),
});

export const updateUserSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    branchId: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const getUsersQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => Math.max(1, parseInt(v ?? '1', 10))),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(100, Math.max(1, parseInt(v ?? '20', 10)))),
  role: z.enum(['STORE_ADMIN', 'BRANCH_MANAGER', 'CASHIER']).optional(),
  branchId: z.string().optional(),
  isActive: z
    .string()
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  search: z.string().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type GetUsersQuery = z.infer<typeof getUsersQuerySchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
