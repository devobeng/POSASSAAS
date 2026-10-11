import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/axios';
import type { ApiResponse, SubscriptionPlan, SubscriptionStatus } from '@/types';

export function usePlans() {
  return useQuery({
    queryKey: ['plans'],
    queryFn: () =>
      api.get<ApiResponse<SubscriptionPlan[]>>('/plans').then((r) => r.data.data),
  });
}

export interface SubscriptionStatusData {
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  /** End of the prepaid (Mobile Money) period; null for card/free. */
  currentPeriodEnd: string | null;
  billingMode: 'card' | 'prepaid' | 'none';
  subscriptionPlan: SubscriptionPlan | null;
}

export type BillingMethod = 'card' | 'mobile_money';
export const PREPAID_MONTH_OPTIONS = [1, 3, 6, 12] as const;

export function useSubscriptionStatus() {
  return useQuery({
    queryKey: ['subscription'],
    queryFn: () =>
      api.get<ApiResponse<SubscriptionStatusData>>('/payments/subscription').then((r) => r.data.data),
  });
}

export interface SubscribeResult {
  free: boolean;
  authorization_url?: string;
  access_code?: string;
  reference?: string;
  alreadyActive?: boolean;
  prepaid?: boolean;
  months?: number;
  /** Amount charged, smallest currency unit (pesewas). */
  amount?: number;
}

export function useSubscribeToPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { planId: string; method: BillingMethod; months?: number }) =>
      api
        .post<ApiResponse<SubscribeResult>>('/payments/subscribe', vars)
        .then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscription'] });
      qc.invalidateQueries({ queryKey: ['store'] });
    },
  });
}
