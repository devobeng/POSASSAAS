'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Product } from '../types';

export interface CartItem {
  productId: string;
  productName: string;
  unitPrice: number;  // in GHS (already divided by 100 from server pesewas)
  taxRate: number;    // percentage, e.g. 15 = 15%
  quantity: number;
  imageUrl?: string | null;
}

interface CartState {
  items: CartItem[];
  discountAmount: number;  // in GHS

  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  setDiscount: (amount: number) => void;
  clearCart: () => void;

  subtotal: () => number;
  taxTotal: () => number;
  grandTotal: () => number;
  itemCount: () => number;
}

// Persisted to sessionStorage (not localStorage): the cart is till-session
// data — it should survive a page reload or crash mid-sale, but never leak
// across devices or linger long after the tab/session ends. It is explicitly
// cleared on "New Sale" (see pos/page.tsx handleNewSale) and on logout (see
// authStore.clearAuth).
export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      discountAmount: 0,

      addItem: (product, quantity = 1) => {
        set((s) => {
          const existing = s.items.find((i) => i.productId === product.id);
          if (existing) {
            return {
              items: s.items.map((i) =>
                i.productId === product.id ? { ...i, quantity: i.quantity + quantity } : i,
              ),
            };
          }
          return {
            items: [
              ...s.items,
              {
                productId: product.id,
                productName: product.name,
                // Server stores money in pesewas (smallest unit); divide by 100 for display
                unitPrice: parseFloat(String(product.sellingPrice)) / 100,
                taxRate: parseFloat(String(product.taxRate)),
                quantity,
                imageUrl: product.imageUrl,
              },
            ],
          };
        });
      },

      removeItem: (productId) =>
        set((s) => ({ items: s.items.filter((i) => i.productId !== productId) })),

      updateQuantity: (productId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(productId);
          return;
        }
        set((s) => ({
          items: s.items.map((i) => (i.productId === productId ? { ...i, quantity } : i)),
        }));
      },

      setDiscount: (amount) => set({ discountAmount: Math.max(0, amount) }),

      clearCart: () => set({ items: [], discountAmount: 0 }),

      subtotal: () =>
        get().items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),

      taxTotal: () =>
        get().items.reduce(
          (sum, i) => sum + i.unitPrice * i.quantity * (i.taxRate / 100),
          0,
        ),

      grandTotal: () => {
        const { subtotal, taxTotal, discountAmount } = get();
        return Math.max(0, subtotal() + taxTotal() - discountAmount);
      },

      itemCount: () => get().items.reduce((n, i) => n + i.quantity, 0),
    }),
    {
      name: 'pos-cart-store',
      storage: createJSONStorage(() => sessionStorage),
      // Only persist the raw cart data — the action/getter functions above
      // aren't serializable and are always supplied fresh by `create`.
      partialize: (state) => ({ items: state.items, discountAmount: state.discountAmount }),
    },
  ),
);
