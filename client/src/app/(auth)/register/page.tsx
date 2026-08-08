'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import api from '@/lib/axios';
import { useAuthStore } from '@/store/authStore';
import PasswordInput from '@/components/ui/PasswordInput';
import type { ApiResponse, User, Store } from '@/types';

interface RegisterResponse {
  accessToken: string;
  user: User;
  store: Store;
}

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [form, setForm] = useState({
    storeName: '',
    ownerName: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');

  const { mutate: register, isPending } = useMutation({
    mutationFn: (data: Omit<typeof form, 'confirmPassword'>) =>
      api
        .post<ApiResponse<RegisterResponse>>('/auth/register-store', data)
        .then((r) => r.data.data),
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken);
      router.push('/select-plan');
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setError(err.response?.data?.message ?? 'Registration failed');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    const { confirmPassword: _, ...payload } = form;
    register(payload);
  };

  const field = (
    id: keyof typeof form,
    label: string,
    type = 'text',
    placeholder = '',
  ) => {
    const inputClass = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';
    return (
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {label}
        </label>
        {type === 'password' ? (
          <PasswordInput
            id={id}
            required
            autoComplete={id}
            value={form[id]}
            onChange={(e) => setForm((f) => ({ ...f, [id]: e.target.value }))}
            placeholder={placeholder}
            className={inputClass}
          />
        ) : (
          <input
            id={id}
            type={type}
            required
            autoComplete={id}
            value={form[id]}
            onChange={(e) => setForm((f) => ({ ...f, [id]: e.target.value }))}
            placeholder={placeholder}
            className={inputClass}
          />
        )}
      </div>
    );
  };

  return (
    <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Create your store</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Start your free trial — no credit card required.
      </p>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {field('storeName', 'Store name', 'text', 'My Awesome Store')}
        {field('ownerName', 'Your name', 'text', 'Jane Doe')}
        {field('phone', 'Phone number', 'tel', '0244123456')}
        {field('email', 'Email address', 'email', 'you@example.com')}
        {field('password', 'Password', 'password', '••••••••')}
        {field('confirmPassword', 'Confirm password', 'password', '••••••••')}

        <button
          type="submit"
          disabled={isPending}
          className="w-full py-2.5 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors mt-2"
        >
          {isPending ? 'Creating store…' : 'Create store'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
        Already have an account?{' '}
        <Link href="/login" className="text-primary-600 hover:underline font-medium">
          Sign in
        </Link>
      </p>
    </div>
  );
}
