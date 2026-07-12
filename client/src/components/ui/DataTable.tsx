'use client';

import type { PaginationMeta } from '@/types';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  keyExtractor: (row: T) => string;
  pagination?: PaginationMeta;
  onPageChange?: (page: number) => void;
  search?: string;
  onSearch?: (q: string) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
  emptyDescription?: string;
  headerActions?: React.ReactNode;
  onRowClick?: (row: T) => void;
}

export default function DataTable<T>({
  columns,
  data,
  isLoading,
  keyExtractor,
  pagination,
  onPageChange,
  search,
  onSearch,
  searchPlaceholder = 'Search…',
  emptyMessage = 'No records found',
  emptyDescription,
  headerActions,
  onRowClick,
}: Props<T>) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
      {(onSearch !== undefined || headerActions) && (
        <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-800 flex-wrap">
          {onSearch !== undefined && (
            <div className="relative w-64">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="search"
                value={search ?? ''}
                onChange={(e) => onSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-9 pr-3 py-2 text-sm w-full border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          )}
          {headerActions && <div className="flex items-center gap-2 ml-auto">{headerActions}</div>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
              {columns.map((col) => (
                <th key={col.key} className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap ${col.className ?? ''}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-gray-800/50">
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3">
                      <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" style={{ width: `${50 + ((i * 13 + col.key.length * 7) % 40)}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16 text-center">
                  <p className="text-gray-400 dark:text-gray-500 font-medium">{emptyMessage}</p>
                  {emptyDescription && <p className="text-gray-300 dark:text-gray-600 text-xs mt-1">{emptyDescription}</p>}
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr
                  key={keyExtractor(row)}
                  onClick={() => onRowClick?.(row)}
                  className={`border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-3 text-gray-800 dark:text-gray-200 ${col.className ?? ''}`}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {pagination.total.toLocaleString()} record{pagination.total !== 1 ? 's' : ''} &mdash; page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex gap-1">
            <button onClick={() => onPageChange?.(pagination.page - 1)} disabled={pagination.page <= 1} className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300">
              ← Prev
            </button>
            <button onClick={() => onPageChange?.(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages} className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300">
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
