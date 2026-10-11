import crypto from 'crypto';
import { env } from '../config/env';

const BASE_URL = 'https://api.paystack.co';
// A hung Paystack response must not hang a POS checkout or a webhook handler
// forever — fail fast and let the caller's existing error handling take over.
const REQUEST_TIMEOUT_MS = 10_000;

async function paystackRequest<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error(`Paystack request timed out after ${REQUEST_TIMEOUT_MS}ms: ${method} ${path}`);
    }
    throw err;
  }

  const data = (await res.json()) as { status: boolean; message?: string; data: T };

  if (!res.ok || !data.status) {
    throw new Error(data.message ?? `Paystack error: ${res.status}`);
  }

  return data.data;
}

// ─── Transaction ──────────────────────────────────────────────────────────────

export interface TransactionInit {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export function initializeTransaction(params: {
  email: string;
  amount: number; // smallest currency unit (kobo / pesewas)
  reference?: string;
  callback_url?: string;
  metadata?: Record<string, unknown>;
  // Linking a Plan code here (vs. calling /subscription separately) is
  // Paystack's own recommended pattern for checkout-initiated subscriptions:
  // Paystack creates the recurring Subscription itself once this charge
  // succeeds, using the authorization the customer just gave — no separate
  // POST /subscription call needed (that's only for admin-initiated
  // subscriptions against an authorization you already hold).
  plan?: string;
  // Restricts which payment options Paystack's checkout shows, e.g.
  // ['mobile_money']. Omitted = whatever the integration has enabled.
  channels?: string[];
  currency?: string;
}): Promise<TransactionInit> {
  return paystackRequest<TransactionInit>('POST', '/transaction/initialize', params as Record<string, unknown>);
}

export interface TransactionVerification {
  status: 'success' | 'failed' | 'abandoned';
  reference: string;
  amount: number;
  currency?: string;
  channel?: string;
  customer: { email: string; customer_code: string };
  metadata: Record<string, unknown>;
}

export function verifyTransaction(reference: string): Promise<TransactionVerification> {
  return paystackRequest<TransactionVerification>('GET', `/transaction/verify/${reference}`);
}

// ─── Customer ─────────────────────────────────────────────────────────────────

export interface CustomerData {
  id: number;
  customer_code: string;
  email: string;
}

export function createCustomer(params: {
  email: string;
  first_name?: string;
  last_name?: string;
}): Promise<CustomerData> {
  return paystackRequest<CustomerData>('POST', '/customer', params as Record<string, unknown>);
}

// ─── Plans ────────────────────────────────────────────────────────────────────

export interface PlanData {
  id: number;
  plan_code: string;
  name: string;
  amount: number;
  interval: string;
}

export function createPlan(params: {
  name: string;
  amount: number;
  interval: 'monthly' | 'annually' | 'quarterly';
}): Promise<PlanData> {
  return paystackRequest<PlanData>('POST', '/plan', params as Record<string, unknown>);
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

export interface SubscriptionData {
  id: number;
  subscription_code: string;
  email_token: string;
  status: string;
}

export function createSubscription(params: {
  customer: string; // email or customer_code
  plan: string;     // plan_code
  start_date?: string;
}): Promise<SubscriptionData> {
  return paystackRequest<SubscriptionData>('POST', '/subscription', params as Record<string, unknown>);
}

export function fetchSubscription(subscriptionCode: string): Promise<SubscriptionData> {
  return paystackRequest<SubscriptionData>('GET', `/subscription/${subscriptionCode}`);
}

export function disableSubscription(params: {
  code: string;
  token: string;
}): Promise<{ id: number }> {
  return paystackRequest<{ id: number }>('POST', '/subscription/disable', params as Record<string, unknown>);
}

export function enableSubscription(params: {
  code: string;
  token: string;
}): Promise<{ id: number }> {
  return paystackRequest<{ id: number }>('POST', '/subscription/enable', params as Record<string, unknown>);
}

// ─── Webhook signature verification ───────────────────────────────────────────

export function verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
  if (!env.PAYSTACK_SECRET_KEY) return false;
  const hash = crypto
    .createHmac('sha512', env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  return hash === signature;
}
