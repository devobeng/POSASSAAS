import { redirect } from 'next/navigation';

// Root always redirects — auth middleware decides the final destination.
export default function RootPage() {
  redirect('/dashboard');
}
