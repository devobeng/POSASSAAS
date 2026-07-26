'use client';

import Image from 'next/image';
import { Package } from 'lucide-react';
import type { Product } from '@/types';

interface Props {
  product: Product;
  stock: number;
  cartQty: number;
  onAdd: () => void;
}

function StockBadge({ stock, cartQty }: { stock: number; cartQty: number }) {
  const available = stock - cartQty;
  if (available <= 0)
    return (
      <span className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded-full font-medium">
        {stock <= 0 ? 'Out of stock' : 'Max in cart'}
      </span>
    );
  if (available <= 5)
    return (
      <span className="text-[10px] bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 px-1.5 py-0.5 rounded-full font-medium">
        {available} left
      </span>
    );
  return (
    <span className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full font-medium">
      {stock} in stock
    </span>
  );
}

export default function ProductCard({ product, stock, cartQty, onAdd }: Props) {
  const available = stock - cartQty;
  const disabled = available <= 0;
  // sellingPrice from server is in pesewas; divide by 100 for display
  const price = parseFloat(String(product.sellingPrice)) / 100;

  return (
    <button
      onClick={onAdd}
      disabled={disabled}
      className={`relative flex flex-col p-2.5 rounded-xl border text-left transition-all select-none ${
        disabled
          ? 'border-gray-100 dark:border-gray-800 opacity-40 cursor-not-allowed bg-gray-50 dark:bg-gray-900'
          : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-md active:scale-95 cursor-pointer'
      }`}
    >
      {/* Image */}
      <div className="w-full aspect-square rounded-lg bg-gray-100 dark:bg-gray-800 mb-2 overflow-hidden flex items-center justify-center">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            width={120}
            height={120}
            className="w-full h-full object-cover"
          />
        ) : (
          <Package className="w-8 h-8 text-gray-300 dark:text-gray-700" />
        )}
      </div>

      {/* Cart quantity badge */}
      {cartQty > 0 && (
        <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary-600 text-white text-[10px] font-bold flex items-center justify-center">
          {cartQty}
        </span>
      )}

      <p className="text-xs font-medium text-gray-900 dark:text-gray-100 leading-tight line-clamp-2 mb-1 flex-1">
        {product.name}
      </p>

      <div className="mt-auto space-y-1">
        <p className="text-sm font-bold text-primary-600 dark:text-primary-400">
          {price.toFixed(2)}
        </p>
        <StockBadge stock={stock} cartQty={cartQty} />
      </div>
    </button>
  );
}
