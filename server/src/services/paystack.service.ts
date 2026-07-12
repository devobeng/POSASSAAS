import crypto from 'crypto';
import { env } from '../config/env';

const BASE_URL = 'https://api.paystack.co';

async function paystackRequest<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

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
}): Promise<TransactionInit> {
  return paystackRequest<TransactionInit>('POST', '/transaction/initialize', params as Record<string, unknown>);
}

export interface TransactionVerification {
  status: 'success' | 'failed' | 'abandoned';
  reference: string;
  amount: number;
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

// ─── Webhook signature verification ───────────────────────────────────────────

export function verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
  if (!env.PAYSTACK_SECRET_KEY) return false;
  const hash = crypto
    .createHmac('sha512', env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  return hash === signature;
}
