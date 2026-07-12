'use client';

import { useState } from 'react';
import { useCartStore } from '@/store/cartStore';
import { useConnectivityStore } from '@/store/connectivityStore';

interface Props {
  onCharge: () => void;
}

export default function CartPanel({ onCharge }: Props) {
  const items = useCartStore((s) => s.items);
  const discountAmount = useCartStore((s) => s.discountAmount);
  const subtotal = useCartStore((s) => s.subtotal);
  const taxTotal = useCartStore((s) => s.taxTotal);
  const grandTotal = useCartStore((s) => s.grandTotal);
  const itemCount = useCartStore((s) => s.itemCount);
  const setDiscount = useCartStore((s) => s.setDiscount);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clearCart);

  const connectivityStatus = useConnectivityStore((s) => s.status);
  const pendingCount = useConnectivityStore((s) => s.pendingCount);
  const isOffline = connectivityStatus === 'offline';

  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountInput, setDiscountInput] = useState('');

  const handleDiscountChange = (val: string) => {
    setDiscountInput(val);
    const num = parseFloat(val) || 0;
    setDiscount(discountType === 'percent' ? (subtotal() * num) / 100 : num);
  };

  const toggleDiscountType = () => {
    const next = discountType === 'fixed' ? 'percent' : 'fixed';
    setDiscountType(next);
    setDiscountInput('');
    setDiscount(0);
  };

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          Cart
          {itemCount() > 0 && (
            <span className="ml-1.5 text-primary-600 dark:text-primary-400">({itemCount()})</span>
          )}
        </h2>
        {items.length > 0 && (
          <button
            onClick={clearCart}
            className="text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 font-medium"
          >
            Clear
          </button>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-2">
            <span className="text-4xl">🛒</span>
            <p className="text-sm text-gray-400 dark:text-gray-500">Cart is empty</p>
            <p className="text-xs text-gray-300 dark:text-gray-700">Tap a product to add it</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50 dark:divide-gray-800/50">
            {items.map((item) => (
              <li key={item.productId} className="px-4 py-3 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate leading-snug">
                    {item.productName}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {fmt(item.unitPrice)} ea
                    {item.taxRate > 0 && (
                      <span className="ml-1 opacity-60">+{item.taxRate}% tax</span>
                    )}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <p className="text-xs font-bold text-gray-900 dark:text-gray-100">
                    {fmt(item.unitPrice * item.quantity)}
                  </p>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                      className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-center text-sm font-medium"
                    >
                      −
                    </button>
                    <span className="text-xs w-6 text-center font-semibold text-gray-900 dark:text-gray-100">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                      className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-center text-sm font-medium"
                    >
                      +
                    </button>
                    <button
                      onClick={() => removeItem(item.productId)}
                      className="ml-1 w-5 h-5 flex items-center justify-center text-red-400 hover:text-red-600 dark:text-red-500 text-xs"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Discount + totals + charge button */}
      {items.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-800 shrink-0">
          {/* Discount row */}
          <div className="px-4 pt-3 pb-1 flex items-center gap-2">
            <button
              onClick={toggleDiscountType}
              className="text-[11px] text-primary-600 dark:text-primary-400 font-semibold shrink-0 hover:underline"
            >
              {discountType === 'percent' ? '% off' : 'Discount'}
            </button>
            <input
              type="number"
              min="0"
              value={discountInput}
              onChange={(e) => handleDiscountChange(e.target.value)}
              placeholder="0"
              className="flex-1 px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          {/* Totals */}
          <div className="px-4 py-2 space-y-1">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Subtotal</span>
              <span>{fmt(subtotal())}</span>
            </div>
            {taxTotal() > 0 && (
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>Tax</span>
                <span>{fmt(taxTotal())}</span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between text-xs text-green-600 dark:text-green-400">
                <span>Discount</span>
                <span>−{fmt(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-gray-900 dark:text-gray-100 pt-2 border-t border-gray-100 dark:border-gray-800">
              <span>Total</span>
              <span>{fmt(grandTotal())}</span>
            </div>
          </div>

          {/* Offline status strip */}
          {(isOffline || pendingCount > 0) && (
            <div className={`mx-4 mb-1 px-3 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 ${
              isOffline
                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOffline ? 'bg-amber-500' : 'bg-blue-500 animate-pulse'}`} />
              {isOffline
                ? 'Offline — orders will be queued'
                : `${pendingCount} order${pendingCount !== 1 ? 's' : ''} pending sync`}
            </div>
          )}

          {/* Charge */}
          <div className="px-4 pb-4 pt-1">
            <button
              onClick={onCharge}
              className={`w-full py-3 text-white rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
                isOffline
                  ? 'bg-amber-500 hover:bg-amber-600 active:bg-amber-700'
                  : 'bg-primary-600 hover:bg-primary-700 active:bg-primary-800'
              }`}
            >
              <span>{isOffline ? 'Save Offline' : 'Charge'} {fmt(grandTotal())}</span>
              <kbd className="opacity-50 text-[10px] font-normal border border-white/30 rounded px-1">F9</kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
