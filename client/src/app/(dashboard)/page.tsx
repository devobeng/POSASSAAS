import { redirect } from 'next/navigation';

// Root "/" redirects to the dashboard. The Next.js middleware handles
// authentication — unauthenticated users are redirected to /login before
// this page is ever rendered.
export default function RootPage() {
  redirect('/dashboard');
}
