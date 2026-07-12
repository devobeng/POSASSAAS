'use client';

import { useEffect, useState } from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

// Wraps browser-only components (recharts etc.) to avoid SSR hydration issues
export default function ClientOnly({ children, fallback = null }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <>{mounted ? children : fallback}</>;
}
