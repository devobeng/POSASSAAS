'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { useConnectivityStore } from '@/store/connectivityStore';
import PrinterStatus from '@/components/pos/PrinterStatus';

function ConnectivityPill() {
  const status = useConnectivityStore((s) => s.status);
  const pendingCount = useConnectivityStore((s) => s.pendingCount);
  const failedCount = useConnectivityStore((s) => s.failedCount);

  if (status === 'online' && pendingCount === 0 && failedCount === 0) return null;

  if (failedCount > 0) {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        {failedCount} failed
      </span>
    );
  }

  if (status === 'syncing') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        Syncing{pendingCount > 0 ? ` (${pendingCount})` : ''}
      </span>
    );
  }

  if (status === 'offline') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Offline{pendingCount > 0 ? ` · ${pendingCount} queued` : ''}
      </span>
    );
  }

  // Online with pending orders — still syncing
  if (pendingCount > 0) {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        {pendingCount} pending
      </span>
    );
  }

  return null;
}

export default function Topbar() {
  const { user } = useAuthStore();
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const [dark, setDark] = useState(false);

  // Initialise from localStorage (avoids FOUC; root layout script sets the class)
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  return (
    <header className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-gray-100 bg-white dark:bg-gray-900 dark:border-gray-800">
      {/* Sidebar hamburger */}
      <button
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
        className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-400"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div className="flex items-center gap-3">
        {/* Connectivity status pill */}
        <ConnectivityPill />

        {/* Printer status */}
        <PrinterStatus />

        {/* Dark mode toggle */}
        <button
          onClick={toggleDark}
          aria-label="Toggle dark mode"
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-400"
        >
          {dark ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4.22 1.78a1 1 0 011.42 1.42l-.71.7a1 1 0 11-1.42-1.41l.71-.71zM18 9a1 1 0 110 2h-1a1 1 0 110-2h1zM4.22 15.78a1 1 0 001.42-1.42l-.71-.7A1 1 0 003.5 15.07l.72.71zM10 16a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm-6-7H3a1 1 0 000 2h1a1 1 0 100-2zm11.36 4.95a1 1 0 10-1.41 1.41l.7.71a1 1 0 001.42-1.42l-.71-.7zM5.64 4.22a1 1 0 00-1.42 1.41l.71.71a1 1 0 001.41-1.42l-.7-.7zM10 6a4 4 0 100 8 4 4 0 000-8z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          )}
        </button>

        {/* User badge */}
        {user && (
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center uppercase">
              {user.name.charAt(0)}
            </span>
            <div className="hidden sm:block text-right">
              <p className="text-xs font-medium text-gray-800 dark:text-gray-200 leading-none">{user.name}</p>
              <p className="text-[10px] text-gray-400 leading-none mt-0.5">{user.role.replace('_', ' ')}</p>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
