import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/axios';
import type { ApiResponse, Branch } from '@/types';

export function useBranches() {
  return useQuery({
    queryKey: ['branches'],
    queryFn: () =>
      api.get<ApiResponse<Branch[]>>('/branches').then((r) => r.data.data),
  });
}

export function useBranch(id: string) {
  return useQuery({
    queryKey: ['branches', id],
    queryFn: () =>
      api.get<ApiResponse<Branch>>(`/branches/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });
}

export function useCreateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Branch>) =>
      api.post<ApiResponse<Branch>>('/branches', data).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branches'] }),
  });
}

export function useUpdateBranch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Branch>) =>
      api
        .patch<ApiResponse<Branch>>(`/branches/${id}`, data)
        .then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branches'] }),
  });
}

export function useDeleteBranch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/branches/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branches'] }),
  });
}
