'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import type { Role } from '@/types';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles: Role[];
}

function Icon({ path }: { path: string }) {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: <Icon path="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
    roles: ['SUPER_ADMIN', 'STORE_ADMIN', 'BRANCH_MANAGER', 'CASHIER'],
  },
  {
    href: '/pos',
    label: 'POS Terminal',
    icon: <Icon path="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />,
    roles: ['CASHIER'],
  },
  {
    href: '/orders',
    label: 'Orders',
    icon: <Icon path="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />,
    roles: ['STORE_ADMIN', 'BRANCH_MANAGER', 'CASHIER'],
  },
  {
    href: '/products',
    label: 'Products',
    icon: <Icon path="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />,
    roles: ['STORE_ADMIN', 'SUPER_ADMIN'],
  },
  {
    href: '/inventory',
    label: 'Inventory',
    icon: <Icon path="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />,
    roles: ['STORE_ADMIN', 'BRANCH_MANAGER'],
  },
  {
    href: '/expenses',
    label: 'Expenses',
    icon: <Icon path="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />,
    roles: ['STORE_ADMIN', 'BRANCH_MANAGER', 'SUPER_ADMIN'],
  },
  {
    href: '/reports',
    label: 'Reports',
    icon: <Icon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
    roles: ['STORE_ADMIN', 'BRANCH_MANAGER', 'CASHIER'],
  },
  {
    href: '/branches',
    label: 'Branches',
    icon: <Icon path="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" />,
    roles: ['STORE_ADMIN'],
  },
  {
    href: '/users',
    label: 'Users',
    icon: <Icon path="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />,
    roles: ['STORE_ADMIN', 'BRANCH_MANAGER'],
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: <Icon path="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />,
    roles: ['STORE_ADMIN'],
  },
  {
    href: '/admin',
    label: 'Admin',
    icon: <Icon path="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />,
    roles: ['SUPER_ADMIN'],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const { sidebarOpen } = useUiStore();

  const visibleItems = NAV_ITEMS.filter(
    (item) => user && item.roles.includes(user.role),
  );

  const handleLogout = () => {
    clearAuth();
    router.push('/login');
  };

  return (
    <aside
      className={`flex flex-col bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800 shrink-0 transition-all duration-200 ${
        sidebarOpen ? 'w-56' : 'w-0 overflow-hidden'
      }`}
    >
      {/* Logo */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <span className="text-lg font-bold text-primary-600">POS SaaS</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="p-4 border-t border-gray-100 dark:border-gray-800">
        <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{user?.name}</p>
        <p className="text-xs text-gray-400 truncate mb-3">{user?.email}</p>
        <button
          onClick={handleLogout}
          className="w-full text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-left font-medium"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
