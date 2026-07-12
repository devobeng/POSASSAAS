'use client';

import { useEffect, useCallback } from 'react';
import { printerService } from '@/lib/printer/service';
import { usePrinterStore } from '@/store/printerStore';
import type { ReceiptDocument } from '@/lib/receipt/types';
import type { PrinterConfig } from '@/lib/printer/types';

export function usePrinter() {
  const config   = usePrinterStore((s) => s.config);
  const status   = usePrinterStore((s) => s.status);
  const setStatus = usePrinterStore((s) => s.setStatus);

  // Subscribe to service events
  useEffect(() => {
    const handler = () => {
      setStatus({ ...printerService.status });
    };
    printerService.on(handler);
    // Reflect current state on mount
    setStatus({ ...printerService.status });
    return () => printerService.off(handler);
  }, [setStatus]);

  // Auto-detect print agent on mount (silent, only when no transport configured)
  useEffect(() => {
    if (config.transport === 'none') {
      printerService.autoDetect(config).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  const connect = useCallback(async (cfg?: Partial<PrinterConfig>) => {
    const merged = { ...config, ...cfg };
    await printerService.connect(merged);
  }, [config]);

  const disconnect = useCallback(async () => {
    await printerService.disconnect();
  }, []);

  const print = useCallback(async (doc: ReceiptDocument) => {
    await printerService.print(doc);
  }, []);

  const kickDrawer = useCallback(async () => {
    await printerService.kickDrawer();
  }, []);

  return { status, config, connect, disconnect, print, kickDrawer };
}
