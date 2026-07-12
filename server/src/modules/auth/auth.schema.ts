import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const registerStoreSchema = z.object({
  storeName: z.string().min(2).max(100),
  ownerName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number'),
});

export const refreshSchema = z.object({}).strip(); // token comes from cookie, not body

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterStoreInput = z.infer<typeof registerStoreSchema>;
