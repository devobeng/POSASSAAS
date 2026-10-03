import { z } from 'zod';
import { isAllowedRedirectUrl } from '../../utils/url';

// Paystack redirects the paying customer's browser here once checkout
// completes — an unchecked callbackUrl is an open redirect any authenticated
// user could point at a phishing page immediately after a real payment.
const callbackUrlSchema = z
  .string()
  .url()
  .refine(isAllowedRedirectUrl, { message: 'callbackUrl must be on this app\'s own origin' })
  .optional();

export const initializePaymentSchema = z.object({
  orderId: z.string().min(1),
  callbackUrl: callbackUrlSchema,
});

export const subscribeSchema = z.object({
  planId: z.string().min(1),
  callbackUrl: callbackUrlSchema,
});

export type InitializePaymentInput = z.infer<typeof initializePaymentSchema>;
export type SubscribeInput = z.infer<typeof subscribeSchema>;
