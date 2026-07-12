import type { ReceiptDocument, ReceiptSettings } from './types';
import type { Order } from '@/types';
import type { CartItem } from '@/store/cartStore';

interface BuildArgs {
  order: Order;
  items: CartItem[];          // from cart snapshot
  discountAmount: number;     // display units (GHS)
  grandTotal: number;         // display units (GHS)
  cashierName: string;
  storeName: string;
  storeLogoUrl?: string | null;
  currency: string;
  branchName: string;
  branchAddress?: string | null;
  cashTendered?: number;      // for CASH change calculation
  settings: ReceiptSettings;
}

export function buildReceiptDocument(args: BuildArgs): ReceiptDocument {
  const {
    order, items, discountAmount, grandTotal,
    cashierName, storeName, storeLogoUrl, currency,
    branchName, branchAddress, cashTendered, settings,
  } = args;

  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const tax      = items.reduce((s, i) => s + i.unitPrice * i.quantity * (i.taxRate / 100), 0);

  const payments = (order.payments ?? []).map((p) => ({
    method: p.method,
    amount: parseFloat(p.amount) / 100,
  }));

  const cashPayment = payments.find((p) => p.method === 'CASH');
  const change = cashTendered != null
    ? Math.max(0, cashTendered - grandTotal)
    : cashPayment && cashTendered == null
    ? undefined
    : undefined;

  return {
    storeName,
    storeLogoUrl,
    branchName,
    branchAddress,
    orderNumber: order.orderNumber,
    offlineReference: order.orderNumber.startsWith('OFF-') ? order.orderNumber : undefined,
    date: order.createdAt,
    cashierName,
    lines: items.map((i) => ({
      name:      i.productName,
      qty:       i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: i.unitPrice * i.quantity,
    })),
    subtotal,
    tax,
    discount: discountAmount,
    grandTotal,
    payments,
    change,
    headerText:  settings.headerText,
    footerText:  settings.footerText,
    paperWidth:  settings.paperWidth,
    showLogo:    settings.showLogo,
    showQrCode:  settings.showQrCode,
    currency,
  };
}
