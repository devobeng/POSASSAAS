import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/axios';
import type { ApiResponse } from '@/types';
import type { ReceiptSettings } from '@/lib/receipt/types';

export function useReceiptSettings() {
  return useQuery({
    queryKey: ['receipt-settings'],
    queryFn: () =>
      api.get<ApiResponse<ReceiptSettings>>('/store/receipt-settings').then((r) => r.data.data),
  });
}

export function useUpdateReceiptSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<ReceiptSettings>) =>
      api.put<ApiResponse<ReceiptSettings>>('/store/receipt-settings', data).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['receipt-settings'] }),
  });
}
