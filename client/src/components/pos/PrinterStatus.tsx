'use client';

import Link from 'next/link';
import { usePrinterStore } from '@/store/printerStore';

export default function PrinterStatus() {
  const status = usePrinterStore((s) => s.status);

  const dot = status.connected
    ? 'bg-green-500'
    : 'bg-gray-400';

  const label = status.connected
    ? status.transport.toUpperCase().replace('_', ' ')
    : 'No printer';

  return (
    <Link
      href="/settings/hardware"
      title={status.error ?? label}
      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-400"
    >
      <span className="relative flex h-2 w-2">
        <span className={`animate-none absolute inline-flex h-full w-full rounded-full ${dot} opacity-75`} />
        <span className={`relative inline-flex rounded-full h-2 w-2 ${dot}`} />
      </span>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.056 48.056 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
      </svg>
    </Link>
  );
}
