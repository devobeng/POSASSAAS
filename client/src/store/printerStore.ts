'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TransportType, PrinterConfig, PrinterStatus } from '@/lib/printer/types';
import { DEFAULT_PRINTER_CONFIG } from '@/lib/printer/types';

interface PrinterState {
  config: PrinterConfig;
  status: PrinterStatus;

  setConfig: (patch: Partial<PrinterConfig>) => void;
  setStatus: (status: PrinterStatus) => void;
  setTransport: (t: TransportType) => void;
}

export const usePrinterStore = create<PrinterState>()(
  persist(
    (set) => ({
      config: DEFAULT_PRINTER_CONFIG,
      status: { connected: false, transport: 'none' },

      setConfig:    (patch)  => set((s) => ({ config: { ...s.config, ...patch } })),
      setStatus:    (status) => set({ status }),
      setTransport: (t)      => set((s) => ({ config: { ...s.config, transport: t } })),
    }),
    {
      name: 'pos-printer-store',
      // Persist config only — status is runtime
      partialize: (s) => ({ config: s.config }),
    },
  ),
);
