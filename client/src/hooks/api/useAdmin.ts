import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/axios';
import type { ApiResponse, PaginationMeta, SubscriptionStatus } from '@/types';

interface AdminStore {
  id: string;
  name: string;
  slug: string;
  subscriptionPlan: string;
  subscriptionStatus: SubscriptionStatus;
  createdAt: string;
  _count?: { branches: number; users: number };
}

interface PlatformStats {
  totalStores: number;
  activeSubscriptions: number;
  gmv: number;
  totalOrders: number;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  maxBranches: number;
  maxUsers: number;
  features: Record<string, unknown>;
}

export function useAdminStores(params: { page?: number; limit?: number; search?: string } = {}) {
  return useQuery({
    queryKey: ['admin', 'stores', params],
    queryFn: () =>
      api
        .get<ApiResponse<{ items: AdminStore[]; meta: PaginationMeta }>>('/admin/stores', { params })
        .then((r) => r.data.data),
  });
}

export function usePlatformStats() {
  return useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () =>
      api.get<ApiResponse<PlatformStats>>('/admin/stats').then((r) => r.data.data),
    staleTime: 30_000,
  });
}

export function useSuspendStore(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/admin/stores/${id}/suspend`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'stores'] }),
  });
}

export function useActivateStore(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/admin/stores/${id}/activate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'stores'] }),
  });
}

export function useSubscriptionPlans() {
  return useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: () =>
      api.get<ApiResponse<SubscriptionPlan[]>>('/admin/plans').then((r) => r.data.data),
  });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<SubscriptionPlan, 'id'>) =>
      api.post<ApiResponse<SubscriptionPlan>>('/admin/plans', data).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'plans'] }),
  });
}

export function useDeletePlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/admin/plans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'plans'] }),
  });
}
