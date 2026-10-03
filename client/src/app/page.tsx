import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

// Root always redirects — auth middleware handles the logged-out case.
// SUPER_ADMIN has no storeId, so the per-store /dashboard 400s on every
// KPI/report call for them; send them straight to /admin instead.
export default function RootPage() {
  const role = cookies().get('pos-auth')?.value;
  redirect(role === 'SUPER_ADMIN' ? '/admin' : '/dashboard');
}
