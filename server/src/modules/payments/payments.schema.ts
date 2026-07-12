import { z } from 'zod';

export const initializePaymentSchema = z.object({
  orderId: z.string().min(1),
  callbackUrl: z.string().url().optional(),
});

export const subscribeSchema = z.object({
  planId: z.string().min(1),
  callbackUrl: z.string().url().optional(),
});

export type InitializePaymentInput = z.infer<typeof initializePaymentSchema>;
export type SubscribeInput = z.infer<typeof subscribeSchema>;
