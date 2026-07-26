import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/axios';
import type { ApiResponse, InventoryItem, PaginationMeta } from '@/types';

interface InventoryParams {
  branchId: string;
  page?: number;
  limit?: number;
  lowStock?: boolean;
}

export function useInventory(params: InventoryParams) {
  return useQuery({
    queryKey: ['inventory', params],
    queryFn: () =>
      api
        .get<ApiResponse<InventoryItem[]>>('/inventory', { params })
        .then((r) => ({
          items: r.data.data ?? [],
          meta: r.data.meta as PaginationMeta | undefined,
        })),
    enabled: !!params.branchId,
  });
}

export function useLowStock(branchId: string) {
  return useQuery({
    queryKey: ['inventory', 'low-stock', branchId],
    queryFn: () =>
      api
        .get<ApiResponse<InventoryItem[]>>('/inventory/low-stock', {
          params: { branchId },
        })
        .then((r) => r.data.data),
    enabled: !!branchId,
  });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      branchId: string;
      productId: string;
      quantity: number;
      note: string;
    }) =>
      api.post<ApiResponse<InventoryItem>>('/inventory/adjust', data).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useTransferStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      productId: string;
      fromBranchId: string;
      toBranchId: string;
      quantity: number;
      note?: string;
    }) =>
      api
        .post<ApiResponse<unknown>>('/inventory/transfer', data)
        .then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export interface StockMovement {
  id: string;
  type: string;
  quantity: number;
  note: string | null;
  createdAt: string;
  inventoryItem?: { product?: { name: string } | null };
  user?: { name: string } | null;
}

export function useStockMovements(params: {
  branchId?: string;
  productId?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['inventory', 'movements', params],
    queryFn: () =>
      api
        .get<ApiResponse<StockMovement[]>>('/inventory/movements', { params })
        .then((r) => ({
          items: r.data.data ?? [],
          meta: r.data.meta as PaginationMeta | undefined,
        })),
  });
}
