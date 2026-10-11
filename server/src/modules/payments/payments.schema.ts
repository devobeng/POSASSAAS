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

export const PREPAID_MONTH_OPTIONS = [1, 3, 6, 12] as const;

export const subscribeSchema = z.object({
  planId: z.string().min(1),
  callbackUrl: callbackUrlSchema,
  // card = Paystack recurring Plan (auto-renews monthly).
  // mobile_money = prepaid: pay `months` up front, renew manually — Paystack
  // can't auto-debit MoMo, every charge needs approval on the payer's phone.
  method: z.enum(['card', 'mobile_money']).default('card'),
  months: z
    .number()
    .int()
    .refine((m) => (PREPAID_MONTH_OPTIONS as readonly number[]).includes(m), {
      message: `months must be one of ${PREPAID_MONTH_OPTIONS.join(', ')}`,
    })
    .default(1),
});

export type InitializePaymentInput = z.infer<typeof initializePaymentSchema>;
export type SubscribeInput = z.infer<typeof subscribeSchema>;
