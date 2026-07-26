import { z } from 'zod';
import { isValidPhone } from '../../utils/phone';

const phoneSchema = z.string().refine(isValidPhone, 'Enter a valid phone number');

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const loginSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().optional(),
    password: z.string().min(1),
  })
  .refine((data) => data.email || data.phone, {
    message: 'Provide either email or phone',
    path: ['email'],
  });

export const registerStoreSchema = z.object({
  storeName: z.string().min(2).max(100),
  ownerName: z.string().min(2).max(100),
  email: z.string().email().optional(),
  phone: phoneSchema,
  password: passwordSchema,
});

export const refreshSchema = z.object({}).strip(); // token comes from cookie, not body

export const forgotPasswordRequestSchema = z.object({
  phone: phoneSchema,
});

export const forgotPasswordVerifySchema = z.object({
  requestId: z.string().min(1),
  otpCode: z.string().min(1),
});

export const forgotPasswordResetSchema = z.object({
  resetToken: z.string().min(1),
  newPassword: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterStoreInput = z.infer<typeof registerStoreSchema>;
export type ForgotPasswordRequestInput = z.infer<typeof forgotPasswordRequestSchema>;
export type ForgotPasswordVerifyInput = z.infer<typeof forgotPasswordVerifySchema>;
export type ForgotPasswordResetInput = z.infer<typeof forgotPasswordResetSchema>;
