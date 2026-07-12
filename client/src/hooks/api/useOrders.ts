import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/axios';
import type { ApiResponse, Order, OrderStatus, PaginationMeta } from '@/types';
import type { PaymentMethod } from '@/types';

interface OrderListParams {
  page?: number;
  limit?: number;
  branchId?: string;
  cashierId?: string;
  status?: OrderStatus;
  startDate?: string;
  endDate?: string;
}

interface OrderListData {
  items: Order[];
  meta: PaginationMeta;
}

interface CreateOrderPayload {
  items: { productId: string; quantity: number }[];
  discount?: number;
  payments: { method: PaymentMethod; amount: number }[];
  clientOrderId?: string;
  createdAtClient?: string;
  offlineReference?: string;
}

export function useOrders(params: OrderListParams = {}) {
  return useQuery({
    queryKey: ['orders', params],
    queryFn: () =>
      api
        .get<ApiResponse<Order[]>>('/orders', { params })
        .then((r) => ({
          items: r.data.data ?? [],
          meta: r.data.meta as PaginationMeta | undefined,
        })),
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: ['orders', id],
    queryFn: () =>
      api.get<ApiResponse<Order>>(`/orders/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      payload,
      idempotencyKey,
    }: {
      payload: CreateOrderPayload;
      idempotencyKey: string;
    }) =>
      api
        .post<ApiResponse<Order>>('/orders', payload, {
          headers: { 'Idempotency-Key': idempotencyKey },
        })
        .then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useRefundOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (note?: string) =>
      api
        .post<ApiResponse<Order>>(`/orders/${id}/refund`, { note })
        .then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders', id] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useOrderReceipt(id: string, enabled = false) {
  return useQuery({
    queryKey: ['orders', id, 'receipt'],
    queryFn: () =>
      api
        .get<ApiResponse<unknown>>(`/orders/${id}/receipt`)
        .then((r) => r.data.data),
    enabled,
  });
}
