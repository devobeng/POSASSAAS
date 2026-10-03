'use client';

import { useEffect } from 'react';

// Renders inside <main>, below the dashboard layout's Sidebar/Topbar — those
// stay mounted and usable, only the failing page's content is replaced. Cart
// state (Zustand, outside React's tree) survives a "Try again" reset; it's
// only lost on a full page reload, which this deliberately avoids offering
// as the primary action.
export default function DashboardErrorBoundary({
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
    <div className="flex items-center justify-center p-10">
      <div className="w-full max-w-sm text-center space-y-4">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          This page hit an error
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nothing else on the app was affected — any cart or unsaved work in progress is safe. Try again.
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
