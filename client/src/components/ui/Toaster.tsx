'use client';

import { useUiStore } from '@/store/uiStore';
import type { Toast } from '@/store/uiStore';

const COLOURS: Record<Toast['type'], string> = {
  success: 'bg-green-50 border-green-400 text-green-800 dark:bg-green-900/40 dark:border-green-600 dark:text-green-200',
  error:   'bg-red-50 border-red-400 text-red-800 dark:bg-red-900/40 dark:border-red-600 dark:text-red-200',
  warning: 'bg-yellow-50 border-yellow-400 text-yellow-800 dark:bg-yellow-900/40 dark:border-yellow-600 dark:text-yellow-200',
  info:    'bg-blue-50 border-blue-400 text-blue-800 dark:bg-blue-900/40 dark:border-blue-600 dark:text-blue-200',
};

const ICON: Record<Toast['type'], string> = {
  success: '✓',
  error:   '✕',
  warning: '⚠',
  info:    'ℹ',
};

export function Toaster() {
  const { toasts, removeToast } = useUiStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm shadow-lg animate-in slide-in-from-right-5 ${COLOURS[t.type]}`}
        >
          <span className="font-bold shrink-0">{ICON[t.type]}</span>
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => removeToast(t.id)}
            className="shrink-0 opacity-60 hover:opacity-100 text-lg leading-none"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
