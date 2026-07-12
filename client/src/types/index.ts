export type Role = 'SUPER_ADMIN' | 'STORE_ADMIN' | 'BRANCH_MANAGER' | 'CASHIER';
export type ExpenseStatus   = 'PENDING' | 'APPROVED' | 'REJECTED';
export type RecurringInterval = 'WEEKLY' | 'MONTHLY';

export interface ExpenseCategory {
  id: string;
  storeId: string;
  name: string;
  isDefault: boolean;
  _count?: { expenses: number };
}

export interface Expense {
  id: string;
  storeId: string;
  branchId: string | null;
  categoryId: string;
  amount: number;
  description: string;
  expenseDate: string;
  receiptImageUrl: string | null;
  isRecurring: boolean;
  recurringInterval: RecurringInterval | null;
  status: ExpenseStatus;
  rejectionNote: string | null;
  recordedById: string;
  approvedById: string | null;
  createdAt: string;
  updatedAt: string;
  category: { id: string; name: string };
  branch:   { id: string; name: string } | null;
  recordedBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
}
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | 'CANCELLED';
export type OrderStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';
export type PaymentMethod = 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'PAYSTACK';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
export type StockMovementType = 'PURCHASE' | 'SALE' | 'ADJUSTMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'RETURN';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  storeId: string | null;
  branchId: string | null;
  createdAt: string;
  store?: { id: string; name: string; slug: string; currency: string } | null;
  branch?: { id: string; name: string } | null;
}

export interface Store {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  currency: string;
  subscriptionPlan?: string | null;
  subscriptionStatus: SubscriptionStatus;
  createdAt: string;
}

export interface Branch {
  id: string;
  storeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}

export interface Category {
  id: string;
  storeId: string;
  name: string;
}

export interface Product {
  id: string;
  storeId: string;
  categoryId: string | null;
  name: string;
  sku: string;
  barcode: string | null;
  imageUrl: string | null;
  costPrice: string;
  sellingPrice: string;
  taxRate: string;
  isActive: boolean;
  category?: Category | null;
}

export interface InventoryItem {
  id: string;
  productId: string;
  branchId: string;
  quantity: number;
  lowStockThreshold: number;
  product?: Product;
}

export interface Order {
  id: string;
  orderNumber: string;
  storeId: string;
  branchId: string;
  cashierId: string;
  status: OrderStatus;
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  grandTotal: string;
  createdAt: string;
  items?: OrderItem[];
  payments?: Payment[];
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string | null;
  productName: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface Payment {
  id: string;
  orderId: string;
  method: PaymentMethod;
  amount: string;
  paystackReference: string | null;
  status: PaymentStatus;
  createdAt: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  meta?: Record<string, unknown>;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
