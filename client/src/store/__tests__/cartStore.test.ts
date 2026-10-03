import { beforeEach, describe, expect, it } from 'vitest';
import { useCartStore } from '../cartStore';
import type { Product } from '@/types';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    storeId: 'store-1',
    categoryId: null,
    name: 'Widget',
    sku: 'SKU-1',
    barcode: null,
    imageUrl: null,
    costPrice: '600', // pesewas
    sellingPrice: '1000', // pesewas — 10.00 displayed
    taxRate: '0',
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  sessionStorage.clear();
  useCartStore.setState({ items: [], discountAmount: 0 });
});

describe('cartStore totals', () => {
  it('starts empty with zero totals', () => {
    const s = useCartStore.getState();
    expect(s.items).toHaveLength(0);
    expect(s.subtotal()).toBe(0);
    expect(s.taxTotal()).toBe(0);
    expect(s.grandTotal()).toBe(0);
    expect(s.itemCount()).toBe(0);
  });

  it('computes subtotal/tax/grandTotal for a single item', () => {
    useCartStore.getState().addItem(makeProduct({ sellingPrice: '1000', taxRate: '10' }), 2);
    const s = useCartStore.getState();
    expect(s.subtotal()).toBeCloseTo(20, 5); // 10.00 * 2
    expect(s.taxTotal()).toBeCloseTo(2, 5); // 10% of 20
    expect(s.grandTotal()).toBeCloseTo(22, 5);
  });

  it('merges quantity when the same product is added twice', () => {
    const product = makeProduct();
    useCartStore.getState().addItem(product, 1);
    useCartStore.getState().addItem(product, 2);
    const s = useCartStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.items[0].quantity).toBe(3);
    expect(s.itemCount()).toBe(3);
  });

  it('removeItem drops the line entirely', () => {
    const product = makeProduct();
    useCartStore.getState().addItem(product, 1);
    useCartStore.getState().removeItem(product.id);
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('updateQuantity to zero or below removes the item instead of leaving a non-positive quantity', () => {
    const product = makeProduct();
    useCartStore.getState().addItem(product, 3);
    useCartStore.getState().updateQuantity(product.id, 0);
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('clamps a negative discount to zero', () => {
    useCartStore.getState().setDiscount(-5);
    expect(useCartStore.getState().discountAmount).toBe(0);
  });

  it('a 100% discount brings grandTotal to exactly zero, never negative', () => {
    useCartStore.getState().addItem(makeProduct({ sellingPrice: '1000', taxRate: '0' }), 1);
    useCartStore.getState().setDiscount(10);
    expect(useCartStore.getState().grandTotal()).toBe(0);
  });

  it('an over-100% discount still floors grandTotal at zero (never negative)', () => {
    useCartStore.getState().addItem(makeProduct({ sellingPrice: '1000', taxRate: '0' }), 1);
    useCartStore.getState().setDiscount(999);
    expect(useCartStore.getState().grandTotal()).toBe(0);
  });

  it('clearCart resets items and discount together', () => {
    useCartStore.getState().addItem(makeProduct(), 1);
    useCartStore.getState().setDiscount(2);
    useCartStore.getState().clearCart();
    const s = useCartStore.getState();
    expect(s.items).toHaveLength(0);
    expect(s.discountAmount).toBe(0);
  });

  it('persists items/discount to sessionStorage under the cart store key', () => {
    useCartStore.getState().addItem(makeProduct(), 1);
    useCartStore.getState().setDiscount(3);

    const raw = sessionStorage.getItem('pos-cart-store');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.items).toHaveLength(1);
    expect(parsed.state.discountAmount).toBe(3);
  });
});
