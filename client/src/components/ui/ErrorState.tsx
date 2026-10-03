'use client';

import { getErrorMessage } from '@/lib/errors';

interface Props {
  error?: unknown;
  message?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Shared "something went wrong" state — used anywhere a fetch can fail and
 * we want a distinct, actionable state instead of silently rendering an
 * empty list (which reads to the user as "there's just no data").
 */
export default function ErrorState({
  error,
  message = "Couldn't load data",
  description,
  onRetry,
  className = '',
}: Props) {
  return (
    <div className={`flex flex-col items-center justify-center py-10 text-center ${className}`}>
      <p className="text-sm font-medium text-red-600 dark:text-red-400">{message}</p>
      <p className="text-xs text-gray-400 mt-1">
        {description ?? getErrorMessage(error, 'Please try again or check your connection.')}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}
