import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/axios';
import type { ApiResponse, PaginationMeta, Product } from '@/types';

// Payload type for create/update: prices are integers in pesewas (server stores as Int)
export interface ProductPayload {
  name?: string;
  sku?: string;
  barcode?: string;
  categoryId?: string;
  costPrice?: number;     // pesewas
  sellingPrice?: number;  // pesewas
  taxRate?: number;       // percentage, e.g. 15
  isActive?: boolean;
}

interface ProductListParams {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  isActive?: boolean;
}

export function useProducts(params: ProductListParams = {}) {
  return useQuery({
    queryKey: ['products', params],
    queryFn: () =>
      api
        .get<ApiResponse<Product[]>>('/products', { params })
        .then((r) => ({
          items: r.data.data ?? [],
          meta: r.data.meta as PaginationMeta | undefined,
        })),
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: ['products', id],
    queryFn: () =>
      api.get<ApiResponse<Product>>(`/products/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ProductPayload) =>
      api.post<ApiResponse<Product>>('/products', data).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useUpdateProduct(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ProductPayload) =>
      api
        .patch<ApiResponse<Product>>(`/products/${id}`, data)
        .then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products', id] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useDeleteProduct(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/products/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useUploadProductImage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('image', file);
      return api
        .post<ApiResponse<Product>>(`/products/${id}/image`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useImportProductsCSV() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api
        .post<ApiResponse<{ imported: number; errors: { row: number; message: string }[] }>>(
          '/products/import',
          formData,
          { headers: { 'Content-Type': 'multipart/form-data' } },
        )
        .then((r) => r.data.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}
