import Dexie, { type Table } from 'dexie';

// ─── Cached catalog types (from GET /sync/catalog) ────────────────────────────

export interface CachedProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  imageUrl: string | null;
  sellingPrice: number;  // pesewas (integer)
  taxRate: number;       // percentage e.g. 15
  categoryId: string | null;
  updatedAt: string;
}

export interface CachedCategory {
  id: string;
  name: string;
  updatedAt: string;
}

export interface CachedInventory {
  productId: string;
  quantity: number;
  lowStockThreshold: number;
  updatedAt: string;
}

// ─── Pending / failed offline orders ─────────────────────────────────────────

export interface OfflineOrderPayload {
  clientOrderId: string;
  offlineReference: string;
  createdAtClient: string;
  items: { productId: string; quantity: number }[];
  discount: number;         // pesewas
  payments: { method: string; amount: number }[];
}

export interface PendingOrder {
  _localId?: number;        // Dexie auto-increment primary key
  clientOrderId: string;
  payload: OfflineOrderPayload;
  retryCount: number;
  nextRetryAt: number;      // epoch ms — when eligible for next sync attempt
  createdAt: string;
}

export interface FailedOrder {
  _localId?: number;
  clientOrderId: string;
  payload: OfflineOrderPayload;
  error: string;
  failedAt: string;
}

// ─── Sync metadata ────────────────────────────────────────────────────────────

export interface SyncMeta {
  key: string;
  lastSyncAt?: string;
  deviceId?: string;
  counter?: number;
}

// ─── Database class ───────────────────────────────────────────────────────────

class POSDatabase extends Dexie {
  products!: Table<CachedProduct>;
  categories!: Table<CachedCategory>;
  inventory!: Table<CachedInventory>;
  pendingOrders!: Table<PendingOrder>;
  failedOrders!: Table<FailedOrder>;
  syncMeta!: Table<SyncMeta>;

  constructor() {
    super('pos-offline-db');
    this.version(1).stores({
      products:      'id, categoryId, sku, barcode',
      categories:    'id',
      inventory:     'productId',
      pendingOrders: '++_localId, clientOrderId, nextRetryAt',
      failedOrders:  '++_localId, clientOrderId',
      syncMeta:      'key',
    });
    // v2: index category name for POS search/filter queries
    this.version(2).stores({
      categories: 'id, name',
    });
  }
}

export const db = new POSDatabase();

// ─── Device identity helpers ──────────────────────────────────────────────────

export async function getDeviceId(): Promise<string> {
  const meta = await db.syncMeta.get('device');
  if (meta?.deviceId) return meta.deviceId;
  const id = `DEV${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  await db.syncMeta.put({ key: 'device', deviceId: id, counter: 0 });
  return id;
}

export async function nextOfflineCounter(): Promise<number> {
  const meta = await db.syncMeta.get('device') ?? { key: 'device', counter: 0 };
  const counter = (meta.counter ?? 0) + 1;
  await db.syncMeta.put({ ...meta, counter });
  return counter;
}

export async function generateOfflineRef(): Promise<string> {
  const [deviceId, counter] = await Promise.all([getDeviceId(), nextOfflineCounter()]);
  return `OFF-${deviceId}-${String(counter).padStart(4, '0')}`;
}
