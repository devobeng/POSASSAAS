import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';
import type { ApiResponse } from '@/types';

interface DateRangeParams {
  startDate?: string;
  endDate?: string;
  groupBy?: 'day' | 'week' | 'month';
  branchId?: string;
}

export interface DashboardData {
  todaySales: number;
  todayOrderCount: number;
  lowStockCount: number;
  topProducts: { productName: string; totalQuantity: number; totalRevenue: number }[];
}

export function useDashboard(params?: { branchId?: string }) {
  return useQuery({
    queryKey: ['reports', 'dashboard', params],
    queryFn: () =>
      api.get<ApiResponse<DashboardData>>('/reports/dashboard', { params }).then((r) => r.data),
    staleTime: 60_000,
  });
}

export function useSalesSummary(params?: DateRangeParams) {
  return useQuery({
    queryKey: ['reports', 'sales-summary', params],
    queryFn: () =>
      api.get<ApiResponse<unknown>>('/reports/sales-summary', { params }).then((r) => r.data),
    staleTime: 60_000,
  });
}

export function useSalesByProduct(params?: DateRangeParams & { limit?: number }) {
  return useQuery({
    queryKey: ['reports', 'sales-by-product', params],
    queryFn: () =>
      api.get<ApiResponse<unknown>>('/reports/sales-by-product', { params }).then((r) => r.data),
    staleTime: 60_000,
  });
}

export function useSalesByCategory(params?: DateRangeParams) {
  return useQuery({
    queryKey: ['reports', 'sales-by-category', params],
    queryFn: () =>
      api.get<ApiResponse<unknown>>('/reports/sales-by-category', { params }).then((r) => r.data),
    staleTime: 60_000,
  });
}

export function useSalesByCashier(params?: DateRangeParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['reports', 'sales-by-cashier', params],
    queryFn: () =>
      api.get<ApiResponse<unknown>>('/reports/sales-by-cashier', { params }).then((r) => r.data),
    staleTime: 60_000,
    enabled: options?.enabled !== false,
  });
}

export function useSalesByBranch(params?: DateRangeParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['reports', 'sales-by-branch', params],
    queryFn: () =>
      api.get<ApiResponse<unknown>>('/reports/sales-by-branch', { params }).then((r) => r.data),
    staleTime: 60_000,
    enabled: options?.enabled !== false,
  });
}

export function usePaymentMethods(params?: DateRangeParams) {
  return useQuery({
    queryKey: ['reports', 'payment-methods', params],
    queryFn: () =>
      api.get<ApiResponse<unknown>>('/reports/payment-methods', { params }).then((r) => r.data),
    staleTime: 60_000,
  });
}

export function useInventoryValuation(params?: { branchId?: string }, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['reports', 'inventory-valuation', params],
    queryFn: () =>
      api
        .get<ApiResponse<unknown>>('/reports/inventory-valuation', { params })
        .then((r) => r.data),
    staleTime: 60_000,
    enabled: options?.enabled !== false,
  });
}

export function useProfit(params?: DateRangeParams) {
  return useQuery({
    queryKey: ['reports', 'profit', params],
    queryFn: () =>
      api.get<ApiResponse<unknown>>('/reports/profit', { params }).then((r) => r.data),
    staleTime: 60_000,
  });
}
