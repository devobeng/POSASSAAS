'use client';

import { useRef } from 'react';
import { useAuthStore } from '@/store/authStore';
import type { OrderSnapshot } from '@/app/(dashboard)/pos/page';

interface Props {
  snapshot: OrderSnapshot;
  onNewSale: () => void;
}

export default function ReceiptView({ snapshot, onNewSale }: Props) {
  const user = useAuthStore((s) => s.user);
  const receiptRef = useRef<HTMLDivElement>(null);
  const { order, items, discountAmount, grandTotal } = snapshot;

  const fmt = (n: number) => n.toFixed(2);
  const fmtPesewas = (n: string | number) => (parseFloat(String(n)) / 100).toFixed(2);

  const handlePrint = () => window.print();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 print:bg-transparent print:inset-auto print:p-0">
      {/* Screen overlay */}
      <div className="w-full max-w-xs bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] print:hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Receipt</h2>
          <span className="text-xs text-green-600 dark:text-green-400 font-medium bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full">
            ✓ Paid
          </span>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Store info */}
          <div className="text-center">
            <p className="font-bold text-gray-900 dark:text-gray-100 text-base">
              {user?.store?.name ?? 'POS SaaS'}
            </p>
            {user?.branch?.name && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{user.branch.name}</p>
            )}
          </div>

          {/* Order meta */}
          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
            <div className="flex justify-between">
              <span>Order #</span>
              <span className="font-medium text-gray-800 dark:text-gray-200">{order.orderNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>Date</span>
              <span>{new Date(order.createdAt).toLocaleString()}</span>
            </div>
            {user?.name && (
              <div className="flex justify-between">
                <span>Cashier</span>
                <span>{user.name}</span>
              </div>
            )}
          </div>

          <hr className="border-dashed border-gray-200 dark:border-gray-700" />

          {/* Line items */}
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.productId} className="flex justify-between text-xs">
                <div className="flex-1 min-w-0 pr-2">
                  <p className="font-medium text-gray-800 dark:text-gray-200 truncate">
                    {item.productName}
                  </p>
                  <p className="text-gray-400">
                    {item.quantity} × {fmt(item.unitPrice)}
                  </p>
                </div>
                <span className="font-medium text-gray-800 dark:text-gray-200 shrink-0">
                  {fmt(item.unitPrice * item.quantity)}
                </span>
              </div>
            ))}
          </div>

          <hr className="border-dashed border-gray-200 dark:border-gray-700" />

          {/* Totals */}
          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-gray-500 dark:text-gray-400">
              <span>Subtotal</span>
              <span>{fmtPesewas(order.subtotal)}</span>
            </div>
            {parseFloat(order.taxTotal) > 0 && (
              <div className="flex justify-between text-gray-500 dark:text-gray-400">
                <span>Tax</span>
                <span>{fmtPesewas(order.taxTotal)}</span>
              </div>
            )}
            {parseFloat(order.discountTotal) > 0 && (
              <div className="flex justify-between text-green-600 dark:text-green-400">
                <span>Discount</span>
                <span>−{fmtPesewas(order.discountTotal)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-gray-900 dark:text-gray-100 pt-1 border-t border-gray-100 dark:border-gray-700">
              <span>Total</span>
              <span>{fmtPesewas(order.grandTotal)}</span>
            </div>
          </div>

          {/* Payment breakdown */}
          {order.payments && order.payments.length > 0 && (
            <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
              <p className="font-medium text-gray-700 dark:text-gray-300 text-[11px] uppercase tracking-wide">
                Paid via
              </p>
              {order.payments.map((p) => (
                <div key={p.id} className="flex justify-between">
                  <span>{p.method.replace('_', ' ')}</span>
                  <span>{fmtPesewas(p.amount)}</span>
                </div>
              ))}
            </div>
          )}

          <p className="text-center text-xs text-gray-400 dark:text-gray-500 pt-2">
            Thank you for your purchase!
          </p>
        </div>

        {/* Actions */}
        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex gap-2 shrink-0">
          <button
            onClick={handlePrint}
            className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            🖨 Print
          </button>
          <button
            onClick={onNewSale}
            className="flex-1 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-bold transition-colors"
          >
            New Sale
          </button>
        </div>
      </div>

      {/* Print-only receipt (80mm thermal) */}
      <div ref={receiptRef} className="receipt-print hidden print:block">
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: 14 }}>{user?.store?.name ?? 'POS SaaS'}</strong>
          {user?.branch?.name && <p style={{ fontSize: 11, margin: 0 }}>{user.branch.name}</p>}
        </div>

        <p style={{ fontSize: 10, margin: '4px 0' }}>
          Order: <strong>{order.orderNumber}</strong>
        </p>
        <p style={{ fontSize: 10, margin: '4px 0' }}>
          {new Date(order.createdAt).toLocaleString()}
        </p>
        {user?.name && (
          <p style={{ fontSize: 10, margin: '4px 0' }}>Cashier: {user.name}</p>
        )}

        <hr style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

        {items.map((item) => (
          <div key={item.productId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span style={{ flex: 1 }}>
              {item.productName}
              <br />
              <span style={{ fontSize: 10, color: '#555' }}>
                {item.quantity} × {fmt(item.unitPrice)}
              </span>
            </span>
            <span>{fmt(item.unitPrice * item.quantity)}</span>
          </div>
        ))}

        <hr style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

        {parseFloat(order.taxTotal) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span>Tax</span><span>{fmtPesewas(order.taxTotal)}</span>
          </div>
        )}
        {parseFloat(order.discountTotal) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span>Discount</span><span>-{fmtPesewas(order.discountTotal)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 'bold', marginTop: 6 }}>
          <span>TOTAL</span><span>{fmtPesewas(order.grandTotal)}</span>
        </div>

        {order.payments && order.payments.length > 0 && (
          <>
            <hr style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />
            {order.payments.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span>{p.method.replace('_', ' ')}</span>
                <span>{fmtPesewas(p.amount)}</span>
              </div>
            ))}
          </>
        )}

        <p style={{ textAlign: 'center', fontSize: 11, marginTop: 16 }}>
          Thank you!
        </p>
      </div>
    </div>
  );
}
