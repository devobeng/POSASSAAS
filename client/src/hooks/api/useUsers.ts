import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/axios';
import type { ApiResponse, PaginationMeta, Role, User } from '@/types';

interface UserListParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: Role;
  branchId?: string;
}

export function useUsers(params: UserListParams = {}) {
  return useQuery({
    queryKey: ['users', params],
    queryFn: () =>
      api
        .get<ApiResponse<{ items: User[]; meta: PaginationMeta }>>('/users', { params })
        .then((r) => r.data.data),
  });
}

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
  role: Role;
  branchId?: string;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserPayload) =>
      api.post<ApiResponse<User>>('/users', data).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export interface UpdateUserPayload {
  name?: string;
  role?: Role;
  branchId?: string | null;
  isActive?: boolean;
}

export function useUpdateUser(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateUserPayload) =>
      api.patch<ApiResponse<User>>(`/users/${id}`, data).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeleteUser(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}
