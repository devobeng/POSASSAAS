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

export type AdjustmentReason = 'DAMAGED' | 'EXPIRED' | 'RECOUNT' | 'THEFT_SUSPECTED' | 'OTHER';

export interface AdjustStockResult {
  pending: boolean;
  request?: { id: string; quantity: number; reason: AdjustmentReason; note: string };
  inventoryItem?: InventoryItem;
  movement?: unknown;
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      branchId?: string;
      productId: string;
      quantity: number;
      reason: AdjustmentReason;
      note: string;
    }) =>
      api
        .post<ApiResponse<AdjustStockResult>>('/inventory/adjust', data)
        .then((r) => r.data.data),
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
  reason: AdjustmentReason | null;
  note: string | null;
  createdAt: string;
  inventoryItem?: { product?: { name: string } | null; branch?: { name: string } | null };
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

// ─── Adjustment approval workflow ─────────────────────────────────────────────

export type AdjustmentRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AdjustmentRequest {
  id: string;
  storeId: string;
  branchId: string;
  productId: string;
  quantity: number;
  reason: AdjustmentReason;
  note: string;
  status: AdjustmentRequestStatus;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
  product: { id: string; name: string; sku: string };
  branch: { id: string; name: string };
  requestedBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
}

export function useAdjustmentRequests(params: {
  status?: AdjustmentRequestStatus;
  page?: number;
  limit?: number;
  enabled?: boolean;
}) {
  const { enabled = true, ...query } = params;
  return useQuery({
    queryKey: ['inventory', 'adjustment-requests', query],
    queryFn: () =>
      api
        .get<ApiResponse<AdjustmentRequest[]>>('/inventory/adjustment-requests', { params: query })
        .then((r) => ({
          items: r.data.data ?? [],
          meta: r.data.meta as PaginationMeta | undefined,
        })),
    enabled,
  });
}

export function useApproveAdjustmentRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reviewNote }: { id: string; reviewNote?: string }) =>
      api
        .post<ApiResponse<unknown>>(`/inventory/adjustment-requests/${id}/approve`, { reviewNote })
        .then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useRejectAdjustmentRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reviewNote }: { id: string; reviewNote: string }) =>
      api
        .post<ApiResponse<unknown>>(`/inventory/adjustment-requests/${id}/reject`, { reviewNote })
        .then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory', 'adjustment-requests'] });
    },
  });
}
