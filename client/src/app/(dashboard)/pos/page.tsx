'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useCartStore, type CartItem } from '@/store/cartStore';
import { useConnectivityStore } from '@/store/connectivityStore';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useCatalogSync } from '@/hooks/useCatalogSync';
import { useSyncEngine } from '@/hooks/useSyncEngine';
import { usePrinter } from '@/hooks/usePrinter';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useReceiptSettings } from '@/hooks/api/useReceiptSettings';
import { buildReceiptDocument } from '@/lib/receipt/renderer';
import ProductGrid from '@/components/pos/ProductGrid';
import CartPanel from '@/components/pos/CartPanel';
import ChargeModal from '@/components/pos/ChargeModal';
import ReceiptView from '@/components/pos/ReceiptView';
import SyncIssuesPanel from '@/components/pos/SyncIssuesPanel';
import BarcodeCamera from '@/components/pos/BarcodeCamera';
import { useUiStore } from '@/store/uiStore';
import { useAuditDrawer } from '@/hooks/useAuditDrawer';
import { Store as StoreIcon } from 'lucide-react';
import type { Order } from '@/types';

export interface OrderSnapshot {
  order: Order;
  items: CartItem[];
  discountAmount: number;
  grandTotal: number;
}

export default function POSPage() {
  const user          = useAuthStore((s) => s.user);
  const items         = useCartStore((s) => s.items);
  const discountAmount = useCartStore((s) => s.discountAmount);
  const grandTotal    = useCartStore((s) => s.grandTotal);
  const clearCart     = useCartStore((s) => s.clearCart);
  const failedCount   = useConnectivityStore((s) => s.failedCount);
  const toast         = useUiStore((s) => s.toast);

  const searchRef = useRef<HTMLInputElement>(null);
  const [chargeOpen, setChargeOpen]       = useState(false);
  const [snapshot, setSnapshot]           = useState<OrderSnapshot | null>(null);
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [cameraOpen, setCameraOpen]       = useState(false);

  // Offline + sync hooks
  useConnectivity();
  useCatalogSync(user?.branchId ?? null);
  useSyncEngine();

  // Printer
  const { print, kickDrawer, status: printerStatus } = usePrinter();

  // Receipt settings (needed to build receipt document)
  const { data: receiptSettings } = useReceiptSettings();

  // Audit log hook (for drawer opens)
  const { logDrawerOpen } = useAuditDrawer();

  // Barcode scanner (global capture layer) — pass weighted barcode config from receipt settings
  const { handleScan } = useBarcodeScanner({
    weightedBarcodeEnabled: receiptSettings?.weightedBarcodeEnabled ?? false,
    weightedBarcodeType:    receiptSettings?.weightedBarcodeType ?? 'price',
  });

  const handleKeydown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'F9') {
        e.preventDefault();
        if (items.length > 0 && !snapshot && !chargeOpen) setChargeOpen(true);
      }
      if (e.key === 'Escape') {
        if (snapshot) return;
        if (cameraOpen)      { setCameraOpen(false); return; }
        if (syncPanelOpen)   { setSyncPanelOpen(false); return; }
        if (chargeOpen)      { setChargeOpen(false); return; }
        clearCart();
      }
    },
    [chargeOpen, snapshot, syncPanelOpen, cameraOpen, items.length, clearCart],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [handleKeydown]);

  // Called when an order completes — auto-print and open drawer for cash
  const handleOrderSuccess = useCallback(
    async (order: Order, cashTendered?: number) => {
      const snap: OrderSnapshot = {
        order,
        items: [...items],
        discountAmount,
        grandTotal: grandTotal(),
      };
      setSnapshot(snap);
      setChargeOpen(false);

      // Auto-print receipt
      const settings = receiptSettings ?? {
        headerText: null,
        footerText: null,
        paperWidth: 80 as const,
        showLogo: true,
        showQrCode: true,
        weightedBarcodeEnabled: false,
        weightedBarcodeType: 'price' as const,
      };

      const doc = buildReceiptDocument({
        order,
        items: snap.items,
        discountAmount: snap.discountAmount,
        grandTotal: snap.grandTotal,
        cashierName: user?.name ?? 'Cashier',
        storeName:   user?.store?.name ?? 'POS',
        storeLogoUrl: null,
        currency:    user?.store?.currency ?? 'GHS',
        branchName:  user?.branch?.name ?? '',
        cashTendered,
        settings,
      });

      try {
        await print(doc);
      } catch {
        toast('Auto-print failed — use Print on the receipt view', 'error');
      }

      // Open cash drawer for CASH payments
      const hasCash = order.payments?.some((p) => p.method === 'CASH');
      if (hasCash && printerStatus.connected) {
        await kickDrawer();
      }
    },
    [items, discountAmount, grandTotal, print, kickDrawer, printerStatus.connected, receiptSettings, user, toast],
  );

  const handleNewSale = () => {
    clearCart();
    setSnapshot(null);
  };

  // Manager-gated manual drawer open (logged to AuditLog)
  const canOpenDrawer =
    user?.role === 'STORE_ADMIN' ||
    user?.role === 'BRANCH_MANAGER' ||
    user?.role === 'SUPER_ADMIN';

  const handleManualDrawer = async () => {
    if (!printerStatus.connected) {
      toast('No printer connected — drawer unavailable', 'error');
      return;
    }
    await kickDrawer();
    await logDrawerOpen();
    toast('Drawer opened', 'success');
  };

  if (!user?.branchId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8">
          <StoreIcon className="w-10 h-10 mb-3 mx-auto text-gray-300 dark:text-gray-700" />
          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">No branch assigned</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Contact your store admin to assign you to a branch.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden relative">
      {/* Left — product browser */}
      <div className="flex-1 overflow-hidden min-w-0 relative">
        <ProductGrid searchRef={searchRef} branchId={user.branchId} />

        {/* Camera scan button (bottom-right of product grid) */}
        <button
          onClick={() => setCameraOpen(true)}
          title="Scan barcode with camera"
          className="absolute bottom-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
          </svg>
        </button>
      </div>

      {/* Right — cart */}
      <div className="w-80 shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col overflow-hidden">
        <CartPanel onCharge={() => setChargeOpen(true)} />

        {/* Manual drawer open (managers only) */}
        {canOpenDrawer && printerStatus.connected && (
          <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 shrink-0">
            <button
              onClick={handleManualDrawer}
              className="w-full text-xs py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Open cash drawer
            </button>
          </div>
        )}
      </div>

      {/* Sync issues button */}
      {failedCount > 0 && (
        <button
          onClick={() => setSyncPanelOpen(true)}
          className="absolute bottom-4 left-4 flex items-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-lg transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-white" />
          {failedCount} sync {failedCount === 1 ? 'issue' : 'issues'}
        </button>
      )}

      <ChargeModal
        open={chargeOpen}
        onClose={() => setChargeOpen(false)}
        onSuccess={handleOrderSuccess}
      />

      {snapshot && <ReceiptView snapshot={snapshot} onNewSale={handleNewSale} />}
      {syncPanelOpen && <SyncIssuesPanel onClose={() => setSyncPanelOpen(false)} />}
      {cameraOpen && (
        <BarcodeCamera
          onScan={(barcode) => { handleScan(barcode); setCameraOpen(false); }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}
