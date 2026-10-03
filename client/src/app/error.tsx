'use client';

import { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <div className="w-full max-w-sm text-center space-y-4">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Something went wrong
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          An unexpected error occurred. You can try again, or head back to the dashboard.
        </p>
        <div className="flex gap-3 justify-center pt-1">
          <a
            href="/dashboard"
            className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Go to dashboard
          </a>
          <button
            onClick={reset}
            className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
