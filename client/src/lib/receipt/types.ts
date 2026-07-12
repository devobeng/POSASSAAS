// ─── Receipt document model ───────────────────────────────────────────────────
// This is the intermediate representation that both the ESC/POS encoder and the
// HTML renderer consume.  Build it once with buildReceiptDocument() and render
// to either target.

export interface ReceiptLine {
  name: string;
  qty: number;
  unitPrice: number;  // display units (e.g. GHS 12.50 — NOT pesewas)
  lineTotal: number;
}

export interface ReceiptPayment {
  method: string;   // 'CASH', 'CARD', 'MOBILE_MONEY', 'PAYSTACK'
  amount: number;   // display units
}

export interface ReceiptDocument {
  storeName: string;
  storeLogoUrl?: string | null;
  branchName: string;
  branchAddress?: string | null;
  orderNumber: string;
  offlineReference?: string | null;
  date: string;          // ISO-8601
  cashierName: string;
  lines: ReceiptLine[];
  subtotal: number;
  tax: number;
  discount: number;
  grandTotal: number;
  payments: ReceiptPayment[];
  change?: number;       // cash change due
  headerText?: string | null;
  footerText?: string | null;
  paperWidth: 58 | 80;
  showLogo: boolean;
  showQrCode: boolean;
  currency: string;      // e.g. 'GHS'
}

export interface ReceiptSettings {
  headerText?: string | null;
  footerText?: string | null;
  paperWidth: 58 | 80;
  showLogo: boolean;
  showQrCode: boolean;
  weightedBarcodeEnabled: boolean;
  weightedBarcodeType: 'price' | 'weight';
}
