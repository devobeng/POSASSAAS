'use client';

import { useState } from 'react';
import { usePrinter } from '@/hooks/usePrinter';
import { usePrinterStore } from '@/store/printerStore';
import { useUiStore } from '@/store/uiStore';
import { buildReceiptDocument } from '@/lib/receipt/renderer';
import type { TransportType } from '@/lib/printer/types';

const TRANSPORT_LABELS: Record<TransportType, string> = {
  webusb:    'USB (WebUSB)',
  bluetooth: 'Bluetooth (BLE)',
  agent:     'Local Print Agent',
  none:      'None (browser print)',
};

const TRANSPORT_DESC: Record<TransportType, string> = {
  webusb:    'Chrome/Edge on desktop. Plug in the USB cable first.',
  bluetooth: 'Android tablets, BLE thermal printers. Works in Chrome.',
  agent:     'Run the print agent on this PC — works in all browsers.',
  none:      'Falls back to your browser\'s built-in print dialog.',
};

// Demo receipt for test print
const TEST_DOC = buildReceiptDocument({
  order: {
    id: 'test',
    orderNumber: 'TEST-0001',
    storeId: '',
    branchId: '',
    cashierId: '',
    status: 'COMPLETED',
    subtotal: '2000',
    taxTotal: '300',
    discountTotal: '0',
    grandTotal: '2300',
    createdAt: new Date().toISOString(),
    payments: [{ id: 'p1', orderId: 'test', method: 'CASH', amount: '2300', paystackReference: null, status: 'SUCCESS', createdAt: new Date().toISOString() }],
  },
  items: [
    { productId: 'p1', productName: 'Test Product A', unitPrice: 10.00, taxRate: 15, quantity: 2, imageUrl: null },
  ],
  discountAmount: 0,
  grandTotal: 23.00,
  cashierName: 'Test Cashier',
  storeName: 'Your Store',
  storeLogoUrl: null,
  currency: 'GHS',
  branchName: 'Main Branch',
  branchAddress: null,
  settings: {
    headerText: 'TEST RECEIPT',
    footerText: 'This is a test print.',
    paperWidth: 80,
    showLogo: false,
    showQrCode: true,
    weightedBarcodeEnabled: false,
    weightedBarcodeType: 'price',
  },
});

export default function HardwareSettingsPage() {
  const { status, connect, disconnect, print, kickDrawer } = usePrinter();
  const config    = usePrinterStore((s) => s.config);
  const setConfig = usePrinterStore((s) => s.setConfig);
  const toast     = useUiStore((s) => s.toast);

  const [selectedTransport, setSelectedTransport] = useState<TransportType>(config.transport);
  const [agentUrl, setAgentUrl] = useState(config.agentUrl);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await connect({ transport: selectedTransport, agentUrl });
      setConfig({ transport: selectedTransport, agentUrl });
      toast('Printer connected', 'success');
    } catch (err) {
      toast((err as Error).message ?? 'Connection failed', 'error');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    setConfig({ transport: 'none' });
    toast('Printer disconnected', 'success');
  };

  const handleTestPrint = async () => {
    try {
      await print(TEST_DOC);
    } catch {
      toast('Test print failed', 'error');
    }
  };

  const handleDrawerTest = async () => {
    await kickDrawer();
    toast('Drawer kick sent', 'success');
  };

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Hardware</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Device-specific settings — stored in this browser only, not synced to the cloud.
        </p>
      </div>

      {/* Connection status */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
        status.connected
          ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20'
          : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50'
      }`}>
        <span className={`w-2.5 h-2.5 rounded-full ${status.connected ? 'bg-green-500' : 'bg-gray-400'}`} />
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {status.connected
              ? `Connected via ${TRANSPORT_LABELS[status.transport]}`
              : 'No printer connected'}
          </p>
          {status.error && (
            <p className="text-xs text-red-500 mt-0.5">{status.error}</p>
          )}
        </div>
        {status.connected && (
          <div className="flex gap-2">
            <button
              onClick={handleTestPrint}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
            >
              Test print
            </button>
            <button
              onClick={handleDrawerTest}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
            >
              Open drawer
            </button>
          </div>
        )}
      </div>

      {/* Transport picker */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Connection type</h2>
        <div className="space-y-2">
          {(['webusb', 'bluetooth', 'agent', 'none'] as TransportType[]).map((t) => (
            <label
              key={t}
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                selectedTransport === t
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <input
                type="radio"
                name="transport"
                value={t}
                checked={selectedTransport === t}
                onChange={() => setSelectedTransport(t)}
                className="mt-0.5 accent-primary-600"
              />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{TRANSPORT_LABELS[t]}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{TRANSPORT_DESC[t]}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Agent URL (only when agent selected) */}
      {selectedTransport === 'agent' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Agent URL
          </label>
          <input
            type="url"
            value={agentUrl}
            onChange={(e) => setAgentUrl(e.target.value)}
            placeholder="http://localhost:9977"
            className={inputClass}
          />
          <p className="text-xs text-gray-400 mt-1">
            Download and run the print agent on this PC.{' '}
            <a href="/print-agent-setup" className="text-primary-600 dark:text-primary-400 underline">
              Setup instructions →
            </a>
          </p>
        </div>
      )}

      {/* Paper width */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Paper width</h2>
        <div className="flex gap-3">
          {([58, 80] as (58 | 80)[]).map((w) => (
            <label
              key={w}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                config.paperWidth === w
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="paperWidth"
                checked={config.paperWidth === w}
                onChange={() => setConfig({ paperWidth: w })}
                className="accent-primary-600"
              />
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{w}mm</span>
            </label>
          ))}
        </div>
      </div>

      {/* Connect / disconnect */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={handleConnect}
          disabled={connecting || selectedTransport === 'none'}
          className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {connecting ? 'Connecting…' : status.connected ? 'Reconnect' : 'Connect printer'}
        </button>
        {status.connected && (
          <button
            onClick={handleDisconnect}
            className="px-5 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
