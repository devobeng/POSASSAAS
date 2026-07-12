import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/axios';
import type { ApiResponse, Store } from '@/types';

export function useStore() {
  return useQuery({
    queryKey: ['store'],
    queryFn: () =>
      api.get<ApiResponse<Store>>('/store').then((r) => r.data.data),
  });
}

export function useUpdateStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Pick<Store, 'name' | 'currency'>>) =>
      api.patch<ApiResponse<Store>>('/store', data).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store'] }),
  });
}

export function useUploadLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('logo', file);
      return api
        .post<ApiResponse<{ logoUrl: string }>>('/store/logo', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store'] }),
  });
}
