'use client';

import { useState, useEffect } from 'react';
import { useCartStore } from '@/store/cartStore';
import { useCreateOrder } from '@/hooks/api/useOrders';
import { useUiStore } from '@/store/uiStore';
import { useConnectivityStore } from '@/store/connectivityStore';
import { db, generateOfflineRef } from '@/lib/db';
import api from '@/lib/axios';
import type { Order, PaymentMethod } from '@/types';

type ModalMethod = PaymentMethod | 'SPLIT';
type Step = 'payment' | 'paystack-waiting' | 'success';

interface SplitLine {
  method: Exclude<PaymentMethod, 'PAYSTACK'>;
  amount: string;
}

const CASH_ONLY_METHODS: Exclude<PaymentMethod, 'PAYSTACK'>[] = [
  'CASH',
  'CARD',
  'MOBILE_MONEY',
];

const METHOD_LABELS: Record<ModalMethod, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  MOBILE_MONEY: 'Mobile',
  PAYSTACK: 'Online',
  SPLIT: 'Split',
};

const OFFLINE_QUEUE_CAP = 500;
const OFFLINE_QUEUE_WARN = Math.floor(OFFLINE_QUEUE_CAP * 0.8);

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (order: Order) => void;
}

export default function ChargeModal({ open, onClose, onSuccess }: Props) {
  const items = useCartStore((s) => s.items);
  const discountAmount = useCartStore((s) => s.discountAmount);
  const grandTotal = useCartStore((s) => s.grandTotal);
  const subtotal = useCartStore((s) => s.subtotal);
  const taxTotal = useCartStore((s) => s.taxTotal);

  const toast = useUiStore((s) => s.toast);
  const { mutateAsync: createOrder, isPending } = useCreateOrder();
  const isOffline = useConnectivityStore((s) => s.status === 'offline');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [method, setMethod] = useState<ModalMethod>('CASH');
  const [cashTendered, setCashTendered] = useState('');
  const [splitLines, setSplitLines] = useState<SplitLine[]>([
    { method: 'CASH', amount: '' },
    { method: 'CARD', amount: '' },
  ]);
  const [step, setStep] = useState<Step>('payment');
  const [paystackRef, setPaystackRef] = useState<string | null>(null);
  const [paystackUrl, setPaystackUrl] = useState<string | null>(null);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [pendingQueueSize, setPendingQueueSize] = useState(0);

  const total = grandTotal();

  // Check queue size when modal opens (for warning)
  useEffect(() => {
    if (open) {
      db.pendingOrders.count().then(setPendingQueueSize);
    }
  }, [open]);

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setMethod('CASH');
      setCashTendered('');
      setSplitLines([
        { method: 'CASH', amount: total.toFixed(2) },
        { method: 'CARD', amount: '' },
      ]);
      setStep('payment');
      setPaystackRef(null);
      setPaystackUrl(null);
      setCreatedOrderId(null);
    }
  }, [open, total]);

  // If user switches to PAYSTACK while offline, revert to CASH
  useEffect(() => {
    if (isOffline && method === 'PAYSTACK') setMethod('CASH');
  }, [isOffline, method]);

  // Poll Paystack verify every 2 s
  useEffect(() => {
    if (step !== 'paystack-waiting' || !paystackRef || !createdOrderId) return;
    const id = setInterval(async () => {
      try {
        const res = await api.get(`/payments/verify/${paystackRef}`);
        if (res.data?.data?.status === 'SUCCESS') {
          clearInterval(id);
          const receipt = await api.get(`/orders/${createdOrderId}`);
          onSuccess(receipt.data.data);
        }
      } catch {
        // keep polling — backend may return 404 before webhook processes
      }
    }, 2000);
    return () => clearInterval(id);
  }, [step, paystackRef, createdOrderId, onSuccess]);

  const buildPayments = (): { method: PaymentMethod; amount: number }[] => {
    if (method === 'SPLIT') {
      return splitLines
        .filter((l) => parseFloat(l.amount) > 0)
        .map((l) => ({ method: l.method, amount: Math.round(parseFloat(l.amount) * 100) }));
    }
    return [{ method: method as PaymentMethod, amount: Math.round(total * 100) }];
  };

  const handleOfflineCharge = async () => {
    const queueCount = await db.pendingOrders.count();
    if (queueCount >= OFFLINE_QUEUE_CAP) {
      toast('Offline queue is full (500 orders). Please sync before continuing.', 'error');
      return;
    }
    if (queueCount >= OFFLINE_QUEUE_WARN) {
      toast(
        `Offline queue is ${queueCount} orders — sync soon to avoid hitting the limit.`,
        'error',
      );
    }

    const payments = buildPayments();
    const paymentTotal = payments.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(paymentTotal - Math.round(total * 100)) > 1) {
      toast(`Payment amounts must sum to ${total.toFixed(2)}`, 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const clientOrderId = crypto.randomUUID();
      const offlineReference = await generateOfflineRef();

      await db.pendingOrders.add({
        clientOrderId,
        payload: {
          clientOrderId,
          offlineReference,
          createdAtClient: new Date().toISOString(),
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          discount: Math.round(discountAmount * 100),
          payments,
        },
        retryCount: 0,
        nextRetryAt: 0,  // eligible immediately when online
        createdAt: new Date().toISOString(),
      });

      // Decrement local inventory so stock numbers stay accurate offline
      for (const item of items) {
        const inv = await db.inventory.get(item.productId);
        if (inv) {
          await db.inventory.put({ ...inv, quantity: inv.quantity - item.quantity });
        }
      }

      // Build a synthetic Order for the receipt
      const subPesewas = Math.round(subtotal() * 100);
      const taxPesewas = Math.round(taxTotal() * 100);
      const discPesewas = Math.round(discountAmount * 100);
      const grandPesewas = Math.round(total * 100);

      const syntheticOrder: Order = {
        id: clientOrderId,
        orderNumber: offlineReference,
        storeId: '',
        branchId: '',
        cashierId: '',
        status: 'COMPLETED',
        subtotal: String(subPesewas),
        taxTotal: String(taxPesewas),
        discountTotal: String(discPesewas),
        grandTotal: String(grandPesewas),
        createdAt: new Date().toISOString(),
        payments: payments.map((p, i) => ({
          id: `offline-${i}`,
          orderId: clientOrderId,
          method: p.method as PaymentMethod,
          amount: String(p.amount),
          paystackReference: null,
          status: 'SUCCESS',
          createdAt: new Date().toISOString(),
        })),
      };

      onSuccess(syntheticOrder);
    } catch {
      toast('Failed to save offline order — please try again', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOnlineCharge = async () => {
    const payments = buildPayments();
    const paymentTotal = payments.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(paymentTotal - Math.round(total * 100)) > 1) {
      toast(`Payment amounts must sum to ${total.toFixed(2)}`, 'error');
      return;
    }

    // Use a stable UUID as both idempotency key and clientOrderId
    const clientOrderId = crypto.randomUUID();

    try {
      const order = await createOrder({
        payload: {
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          discount: Math.round(discountAmount * 100),
          payments,
          clientOrderId,
          createdAtClient: new Date().toISOString(),
        },
        idempotencyKey: clientOrderId,
      });

      if (method === 'PAYSTACK') {
        const initRes = await api.post('/payments/initialize', { orderId: order.id });
        const { authorizationUrl, reference } = initRes.data.data;
        setPaystackRef(reference);
        setPaystackUrl(authorizationUrl);
        setCreatedOrderId(order.id);
        setStep('paystack-waiting');
        window.open(authorizationUrl, '_blank', 'noopener');
      } else {
        onSuccess(order);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast(e.response?.data?.message ?? 'Order failed — check connection', 'error');
    }
  };

  const handleCharge = () => {
    if (isOffline) return handleOfflineCharge();
    return handleOnlineCharge();
  };

  const cashChange = Math.max(0, (parseFloat(cashTendered) || 0) - total);
  const cashInvalid =
    method === 'CASH' && cashTendered !== '' && parseFloat(cashTendered) < total;

  const splitRemaining =
    total - splitLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);

  const fmt = (n: number) => n.toFixed(2);

  if (!open) return null;

  const isLoading = isPending || isSubmitting;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget && step !== 'paystack-waiting') onClose(); }}
    >
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-base">
              {step === 'paystack-waiting' ? 'Waiting for payment…' : `Charge ${fmt(total)}`}
            </h2>
            {isOffline && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                OFFLINE
              </span>
            )}
          </div>
          {step !== 'paystack-waiting' && (
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-300"
            >
              ✕
            </button>
          )}
        </div>

        {/* Queue warning */}
        {isOffline && pendingQueueSize >= OFFLINE_QUEUE_WARN && (
          <div className="mx-6 mt-4 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {pendingQueueSize} / {OFFLINE_QUEUE_CAP} offline orders queued. Sync soon.
            </p>
          </div>
        )}

        <div className="p-6">
          {step === 'payment' && (
            <>
              {/* Method selector */}
              <div className="flex gap-2 mb-5 flex-wrap">
                {(['CASH', 'CARD', 'MOBILE_MONEY', 'PAYSTACK', 'SPLIT'] as ModalMethod[]).map((m) => {
                  const paystackDisabled = m === 'PAYSTACK' && isOffline;
                  return (
                    <button
                      key={m}
                      onClick={() => !paystackDisabled && setMethod(m)}
                      disabled={paystackDisabled}
                      title={paystackDisabled ? 'Paystack unavailable offline' : undefined}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        paystackDisabled
                          ? 'border-gray-100 dark:border-gray-800 text-gray-300 dark:text-gray-600 cursor-not-allowed'
                          : method === m
                          ? 'bg-primary-600 text-white border-primary-600'
                          : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-primary-400 dark:hover:border-primary-600'
                      }`}
                    >
                      {METHOD_LABELS[m]}
                    </button>
                  );
                })}
              </div>

              {/* CASH */}
              {method === 'CASH' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Amount tendered
                    </label>
                    <input
                      type="number"
                      min={total}
                      step="0.01"
                      value={cashTendered}
                      onChange={(e) => setCashTendered(e.target.value)}
                      placeholder={fmt(total)}
                      autoFocus
                      className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-xl font-mono bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  {cashTendered && (
                    <div className="flex justify-between items-center px-1">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Change</span>
                      <span
                        className={`text-xl font-bold font-mono ${
                          cashChange < 0
                            ? 'text-red-500'
                            : 'text-green-600 dark:text-green-400'
                        }`}
                      >
                        {fmt(cashChange)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* CARD / MOBILE_MONEY */}
              {(method === 'CARD' || method === 'MOBILE_MONEY') && (
                <div className="text-center py-4 space-y-2">
                  <p className="text-4xl">{method === 'CARD' ? '💳' : '📱'}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {method === 'CARD'
                      ? 'Process on card terminal, then confirm'
                      : 'Customer completes mobile money payment, then confirm'}
                  </p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 font-mono">
                    {fmt(total)}
                  </p>
                </div>
              )}

              {/* PAYSTACK */}
              {method === 'PAYSTACK' && (
                <div className="text-center py-4 space-y-2">
                  <p className="text-4xl">🌐</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Opens Paystack checkout in a new tab; this screen polls for completion
                  </p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 font-mono">
                    {fmt(total)}
                  </p>
                </div>
              )}

              {/* SPLIT */}
              {method === 'SPLIT' && (
                <div className="space-y-2.5">
                  {splitLines.map((line, i) => (
                    <div key={i} className="flex gap-2">
                      <select
                        value={line.method}
                        onChange={(e) => {
                          const next = [...splitLines];
                          next[i] = { ...next[i], method: e.target.value as typeof line.method };
                          setSplitLines(next);
                        }}
                        className="flex-1 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none"
                      >
                        {CASH_ONLY_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {METHOD_LABELS[m]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.amount}
                        onChange={(e) => {
                          const next = [...splitLines];
                          next[i] = { ...next[i], amount: e.target.value };
                          setSplitLines(next);
                        }}
                        placeholder="0.00"
                        className="w-28 px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-mono bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none"
                      />
                    </div>
                  ))}
                  <div className="flex justify-between text-sm pt-1">
                    <span className="text-gray-500 dark:text-gray-400">Remaining</span>
                    <span
                      className={`font-bold font-mono ${
                        Math.abs(splitRemaining) < 0.01
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-500'
                      }`}
                    >
                      {fmt(splitRemaining)}
                    </span>
                  </div>
                </div>
              )}

              {/* Confirm */}
              <button
                onClick={handleCharge}
                disabled={isLoading || cashInvalid}
                className="mt-6 w-full py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading
                  ? 'Processing…'
                  : isOffline
                  ? `Save Offline (${fmt(total)})`
                  : `Confirm ${fmt(total)}`}
              </button>
            </>
          )}

          {step === 'paystack-waiting' && (
            <div className="text-center py-6 space-y-4">
              <div className="w-12 h-12 rounded-full border-4 border-primary-200 border-t-primary-600 animate-spin mx-auto" />
              <div>
                <p className="font-medium text-gray-800 dark:text-gray-200">
                  Waiting for Paystack…
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Complete the payment in the opened tab
                </p>
              </div>
              {paystackUrl && (
                <a
                  href={paystackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary-600 dark:text-primary-400 underline"
                >
                  Reopen payment page ↗
                </a>
              )}
              <button
                onClick={() => {
                  setStep('payment');
                  setPaystackRef(null);
                  setCreatedOrderId(null);
                }}
                className="block mx-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mt-2"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
