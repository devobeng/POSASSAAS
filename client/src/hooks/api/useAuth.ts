import { useMutation, useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';
import { useAuthStore } from '@/store/authStore';
import type { ApiResponse, User } from '@/types';

export function useMe() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      api.get<ApiResponse<User>>('/auth/me').then((r) => r.data.data),
    enabled: isAuthenticated(),
  });
}

export function useLogout() {
  const clearAuth = useAuthStore((s) => s.clearAuth);
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => clearAuth(),
  });
}
