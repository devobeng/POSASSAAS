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
  subscriptionPlan: SubscriptionPlan | null;
}

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
}

export function useSubscribeToPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) =>
      api
        .post<ApiResponse<SubscribeResult>>('/payments/subscribe', { planId })
        .then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscription'] });
      qc.invalidateQueries({ queryKey: ['store'] });
    },
  });
}
