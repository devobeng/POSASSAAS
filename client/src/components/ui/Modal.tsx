'use client';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  isLoading?: boolean;
  destructive?: boolean;
}

export default function Modal({
  open, onClose, title, description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm, isLoading, destructive,
}: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
        {description && <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{description}</p>}
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
              destructive ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-primary-600 hover:bg-primary-700 text-white'
            }`}
          >
            {isLoading ? 'Loading…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
