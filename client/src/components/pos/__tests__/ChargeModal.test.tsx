import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChargeModal from '../ChargeModal';
import { useCartStore } from '@/store/cartStore';
import api from '@/lib/axios';
import { db, generateOfflineRef } from '@/lib/db';

vi.mock('@/lib/axios', () => ({
  default: { post: vi.fn(), get: vi.fn() },
}));

vi.mock('@/lib/db', () => ({
  db: {
    pendingOrders: { add: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    inventory: { get: vi.fn().mockResolvedValue(undefined), put: vi.fn() },
  },
  generateOfflineRef: vi.fn().mockResolvedValue('OFF-TEST-0001'),
}));

const mockedPost = api.post as unknown as ReturnType<typeof vi.fn>;

function renderModal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChargeModal open onClose={vi.fn()} onSuccess={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  useCartStore.setState({ items: [], discountAmount: 0 });
  useCartStore.getState().addItem(
    {
      id: 'prod-1',
      storeId: 'store-1',
      categoryId: null,
      name: 'Widget',
      sku: 'SKU-1',
      barcode: null,
      imageUrl: null,
      costPrice: '600',
      sellingPrice: '1000',
      taxRate: '0',
      isActive: true,
    },
    1,
  );
  mockedPost.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChargeModal — idempotency key across a retry', () => {
  it('reuses the same Idempotency-Key/clientOrderId on a manual retry after a failed attempt', async () => {
    const user = userEvent.setup();
    // First attempt fails with an ordinary (non-network) error — the toast
    // path, not the offline-fallback path — so the user can retry the exact
    // same click without the flow silently switching to the offline queue.
    mockedPost.mockRejectedValueOnce({
      response: { status: 400, data: { message: 'Card declined' } },
    });
    mockedPost.mockResolvedValueOnce({ data: { data: { id: 'order-1', orderNumber: 'BR1-000001' } } });

    renderModal();

    const confirmButton = () => screen.getByRole('button', { name: /Confirm/ });

    await user.click(confirmButton());
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));

    await user.click(confirmButton());
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(2));

    const [firstUrl, firstPayload, firstConfig] = mockedPost.mock.calls[0];
    const [secondUrl, secondPayload, secondConfig] = mockedPost.mock.calls[1];

    expect(firstUrl).toBe('/orders');
    expect(secondUrl).toBe('/orders');

    const firstKey = firstConfig.headers['Idempotency-Key'];
    const secondKey = secondConfig.headers['Idempotency-Key'];
    expect(firstKey).toBeTruthy();
    expect(firstKey).toBe(secondKey);

    // The order body's own clientOrderId must match the header too — the
    // backend keys its dedup on this field, not just the header.
    expect(firstPayload.clientOrderId).toBe(firstKey);
    expect(secondPayload.clientOrderId).toBe(firstKey);
  });

  it('falls back to the offline queue (same clientOrderId) when the request gets no response at all', async () => {
    const user = userEvent.setup();
    // No `response` — this is what axios produces for a dropped connection/
    // timeout, indistinguishable from "the server might have processed it".
    mockedPost.mockRejectedValueOnce({ request: {} });

    renderModal();

    await user.click(screen.getByRole('button', { name: /Confirm/ }));

    await waitFor(() => expect(db.pendingOrders.add).toHaveBeenCalledTimes(1));

    const queuedPayload = (db.pendingOrders.add as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const sentClientOrderId = mockedPost.mock.calls[0][1].clientOrderId;

    // The queued offline order carries the SAME id the failed request already
    // sent — so if that request actually reached the server, syncing this
    // queued copy later is a no-op duplicate rather than a second charge.
    expect(queuedPayload.clientOrderId).toBe(sentClientOrderId);
    expect(generateOfflineRef).toHaveBeenCalled();
  });
});
