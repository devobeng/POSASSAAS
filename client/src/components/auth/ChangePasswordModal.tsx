'use client';

import { useState } from 'react';
import { Check, Circle } from 'lucide-react';
import { useChangePassword } from '@/hooks/api/useUsers';
import { useUiStore } from '@/store/uiStore';

interface Props {
  /** Forced mode (e.g. mustChangePassword on first login) hides Cancel and can't be dismissed. */
  forced?: boolean;
  onClose?: () => void;
  onSuccess: () => void;
}

const PASSWORD_RULES = [
  { test: (v: string) => v.length >= 8, label: 'At least 8 characters' },
  { test: (v: string) => /[A-Z]/.test(v), label: 'One uppercase letter' },
  { test: (v: string) => /[0-9]/.test(v), label: 'One number' },
];

export default function ChangePasswordModal({ forced, onClose, onSuccess }: Props) {
  const toast = useUiStore((s) => s.toast);
  const { mutateAsync: changePassword, isPending } = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const rulesMet = PASSWORD_RULES.every((r) => r.test(newPassword));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!rulesMet) {
      setError('Password does not meet the requirements below');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      await changePassword({ currentPassword, newPassword });
      toast('Password updated', 'success');
      onSuccess();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message ?? 'Failed to change password');
    }
  };

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {forced ? 'Set a new password' : 'Change password'}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          {forced
            ? 'You are using a temporary password. Set your own to continue.'
            : 'Enter your current password and choose a new one.'}
        </p>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {forced ? 'Temporary password' : 'Current password'}
            </label>
            <input
              type="password" required autoComplete="current-password"
              value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">New password</label>
            <input
              type="password" required autoComplete="new-password"
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
            <ul className="mt-2 space-y-0.5">
              {PASSWORD_RULES.map((r) => (
                <li key={r.label} className={`text-xs flex items-center gap-1.5 ${r.test(newPassword) ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                  {r.test(newPassword) ? <Check className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />} {r.label}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Confirm new password</label>
            <input
              type="password" required autoComplete="new-password"
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            {!forced && onClose && (
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300">
                Cancel
              </button>
            )}
            <button type="submit" disabled={isPending} className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium disabled:opacity-50">
              {isPending ? 'Saving…' : 'Set password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
