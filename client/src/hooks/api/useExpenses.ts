import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/axios';
import type { ApiResponse, Expense, ExpenseCategory } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExpenseListParams {
  page?: number;
  limit?: number;
  branchId?: string;
  categoryId?: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  startDate?: string;
  endDate?: string;
  format?: 'json' | 'csv';
}

interface ExpenseListData {
  total: number;
  page: number;
  limit: number;
  items: Expense[];
}

interface CreateExpensePayload {
  categoryId: string;
  branchId?: string;
  amount: number;
  description: string;
  expenseDate: string;
  isRecurring?: boolean;
  recurringInterval?: 'WEEKLY' | 'MONTHLY';
}

type UpdateExpensePayload = Partial<Omit<CreateExpensePayload, 'isRecurring' | 'recurringInterval'>>;

// ─── Categories ───────────────────────────────────────────────────────────────

export function useExpenseCategories() {
  return useQuery({
    queryKey: ['expense-categories'],
    queryFn: () =>
      api.get<ApiResponse<ExpenseCategory[]>>('/expenses/categories').then((r) => r.data.data),
  });
}

export function useCreateExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.post<ApiResponse<ExpenseCategory>>('/expenses/categories', { name }).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense-categories'] }),
  });
}

export function useUpdateExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch<ApiResponse<ExpenseCategory>>(`/expenses/categories/${id}`, { name }).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense-categories'] }),
  });
}

export function useDeleteExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense-categories'] }),
  });
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export function useExpenses(params: ExpenseListParams = {}) {
  return useQuery({
    queryKey: ['expenses', params],
    queryFn: () =>
      api.get<ApiResponse<ExpenseListData>>('/expenses', { params }).then((r) => r.data.data),
  });
}

export function useExpense(id: string) {
  return useQuery({
    queryKey: ['expenses', id],
    queryFn: () =>
      api.get<ApiResponse<Expense>>(`/expenses/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateExpensePayload) =>
      api.post<ApiResponse<Expense>>('/expenses', data).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateExpensePayload & { id: string }) =>
      api.patch<ApiResponse<Expense>>(`/expenses/${id}`, data).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useApproveExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ApiResponse<Expense>>(`/expenses/${id}/approve`).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useRejectExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.post<ApiResponse<Expense>>(`/expenses/${id}/reject`, { note }).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useUploadExpenseReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append('receipt', file);
      return api.post(`/expenses/${id}/receipt`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface PnLData {
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  totalExpenses: number;
  netProfit: number;
  netMarginPct: number;
  orderCount: number;
  expensesByCategory: Array<{ categoryId: string; categoryName: string; totalAmount: number }>;
}

export function useProfitAndLoss(
  params: { startDate?: string; endDate?: string; branchId?: string } = {},
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['reports', 'profit-and-loss', params],
    queryFn: () =>
      api.get<ApiResponse<PnLData>>('/reports/profit-and-loss', { params }).then((r) => r.data.data),
    enabled: options?.enabled !== false,
  });
}

export interface ExpensesSummaryData {
  grandTotal: number;
  byCategory: Array<{ categoryId: string; categoryName: string; totalAmount: number; expenseCount: number; share: number }>;
  byPeriod:   Array<{ period: string; totalAmount: number; expenseCount: number }>;
}

export function useExpensesSummary(params: { startDate?: string; endDate?: string; branchId?: string; groupBy?: string } = {}) {
  return useQuery({
    queryKey: ['reports', 'expenses-summary', params],
    queryFn: () =>
      api.get<ApiResponse<ExpensesSummaryData>>('/reports/expenses-summary', { params }).then((r) => r.data.data),
  });
}
