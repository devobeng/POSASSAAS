'use client';

import { useAuthStore } from '@/store/authStore';
import ChangePasswordModal from './ChangePasswordModal';

export default function MustChangePasswordGate() {
  const { user, setAuth, accessToken } = useAuthStore();

  if (!user?.mustChangePassword || !accessToken) return null;

  return (
    <ChangePasswordModal
      forced
      onSuccess={() => setAuth({ ...user, mustChangePassword: false }, accessToken)}
    />
  );
}
