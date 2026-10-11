'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import {
  usePlans,
  useSubscriptionStatus,
  useSubscribeToPlan,
  PREPAID_MONTH_OPTIONS,
  type BillingMethod,
} from '@/hooks/api/usePlans';
import { useUiStore } from '@/store/uiStore';
import api from '@/lib/axios';
import { getErrorMessage } from '@/lib/errors';
import type { SubscriptionPlan } from '@/types';

function daysLeft(until: string | null): number | null {
  if (!until) return null;
  const ms = new Date(until).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function planFeatureList(plan: SubscriptionPlan): string[] {
  const items = [
    `${plan.maxBranches} branch${plan.maxBranches === 1 ? '' : 'es'}`,
    `${plan.maxUsers} user${plan.maxUsers === 1 ? '' : 's'}`,
  ];
  for (const [key, value] of Object.entries(plan.features ?? {})) {
    if (value === true) items.push(key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()));
  }
  return items;
}

export default function SelectPlanPage() {
  const router = useRouter();
  const toast = useUiStore((s) => s.toast);

  const { data: plans, isLoading: plansLoading } = usePlans();
  const { data: status, isLoading: statusLoading } = useSubscriptionStatus();
  const { mutateAsync: subscribe } = useSubscribeToPlan();

  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [waitingRef, setWaitingRef] = useState<string | null>(null);
  const [waitingMethod, setWaitingMethod] = useState<BillingMethod>('card');
  const [method, setMethod] = useState<BillingMethod>('card');
  const [months, setMonths] = useState<number>(1);

  // A store already on prepaid MoMo most likely wants to renew the same way.
  useEffect(() => {
    if (status?.billingMode === 'prepaid') setMethod('mobile_money');
  }, [status?.billingMode]);

  // Poll for checkout completion once a paid-plan popup is open — mirrors the
  // same pattern used for in-store Paystack payments (ChargeModal.tsx).
  useEffect(() => {
    if (!waitingRef) return;
    const id = setInterval(async () => {
      try {
        const res = await api.get(`/payments/verify/${waitingRef}`);
        if (res.data?.data?.paystackStatus === 'success') {
          clearInterval(id);
          toast('Plan activated', 'success');
          router.push('/dashboard');
        }
      } catch {
        // keep polling — webhook may not have processed yet
      }
    }, 2000);
    return () => clearInterval(id);
  }, [waitingRef, router, toast]);

  const handleSelect = async (plan: SubscriptionPlan) => {
    setSelectingId(plan.id);
    try {
      const isFree = parseFloat(plan.price) === 0;
      const payMethod: BillingMethod = isFree ? 'card' : method;
      const result = await subscribe({
        planId: plan.id,
        method: payMethod,
        ...(payMethod === 'mobile_money' && { months }),
      });
      if (result.alreadyActive) {
        toast('You are already on this plan', 'info');
        return;
      }
      if (result.free) {
        toast('Free plan activated', 'success');
        router.push('/dashboard');
        return;
      }
      if (result.authorization_url && result.reference) {
        setWaitingRef(result.reference);
        setWaitingMethod(payMethod);
        window.open(result.authorization_url, '_blank', 'noopener');
      }
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to select plan'), 'error');
    } finally {
      setSelectingId(null);
    }
  };

  const isLoading = plansLoading || statusLoading;
  const trialDays = status?.subscriptionStatus === 'TRIAL' ? daysLeft(status.trialEndsAt) : null;
  const paidDays = status?.billingMode === 'prepaid' ? daysLeft(status.currentPeriodEnd) : null;
  const currentPlanId = status?.subscriptionPlan?.id;
  const isPrepaid = status?.billingMode === 'prepaid';

  if (status?.subscriptionStatus === 'SUSPENDED') {
    return (
      <div className="p-6 max-w-md mx-auto text-center space-y-3 pt-16">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Your store has been suspended</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Contact support to reactivate your account — plans can&apos;t be changed while suspended.
        </p>
      </div>
    );
  }

  if (waitingRef) {
    return (
      <div className="p-6 max-w-md mx-auto text-center space-y-4 pt-16">
        <div className="w-12 h-12 rounded-full border-4 border-primary-200 border-t-primary-600 animate-spin mx-auto" />
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Waiting for payment…</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {waitingMethod === 'mobile_money'
            ? 'Enter your Mobile Money number in the tab that just opened, then approve the prompt on your phone. This page updates automatically once payment succeeds.'
            : 'Complete checkout in the tab that just opened. This page updates automatically once payment succeeds.'}
        </p>
        <button
          onClick={() => setWaitingRef(null)}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline"
        >
          Cancel and pick a different plan
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Choose your plan</h1>
        {status?.subscriptionStatus === 'EXPIRED' ? (
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
            {isPrepaid
              ? 'Your paid period has ended. Renew to keep using the app.'
              : 'Your trial has ended. Pick a plan to keep using the app.'}
          </p>
        ) : paidDays !== null && status?.currentPeriodEnd ? (
          <p className={`text-sm mt-1 ${paidDays <= 7 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>
            Paid until {new Date(status.currentPeriodEnd).toLocaleDateString()} ({paidDays} day
            {paidDays === 1 ? '' : 's'} left). Mobile Money doesn&apos;t renew automatically — pay again
            below to extend.
          </p>
        ) : trialDays !== null ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {trialDays > 0
              ? `${trialDays} day${trialDays === 1 ? '' : 's'} left on your free trial.`
              : 'Your free trial ends today.'}
          </p>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Pick the plan that fits your store, or switch anytime.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">How do you want to pay?</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {([
            { value: 'card', title: 'Card', hint: 'Auto-renews every month' },
            { value: 'mobile_money', title: 'Mobile Money', hint: 'Prepay 1–12 months, renew manually' },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMethod(opt.value)}
              className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                method === opt.value
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">{opt.title}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">{opt.hint}</span>
            </button>
          ))}
        </div>
        {method === 'mobile_money' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Pay for:</span>
            {PREPAID_MONTH_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonths(m)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  months === m
                    ? 'border-primary-500 bg-primary-600 text-white'
                    : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300'
                }`}
              >
                {m} month{m === 1 ? '' : 's'}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-64 bg-gray-100 dark:bg-gray-800 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {plans?.map((plan) => {
            const price = parseFloat(plan.price);
            const onThisPlan = plan.id === currentPlanId && status?.subscriptionStatus === 'ACTIVE';
            const momo = method === 'mobile_money' && price > 0;
            // MoMo on the current plan is a renewal, so only a card (or free)
            // store re-picking its own plan is a true no-op.
            const isCurrent = onThisPlan && (price === 0 || (!momo && !isPrepaid));
            const buttonLabel = isCurrent
              ? 'Current plan'
              : selectingId === plan.id
                ? 'Starting…'
                : price === 0
                  ? 'Switch to Free'
                  : momo
                    ? onThisPlan && isPrepaid ? 'Extend with MoMo' : 'Pay with MoMo'
                    : 'Subscribe with card';
            return (
              <div
                key={plan.id}
                className={`rounded-2xl border p-5 flex flex-col ${
                  isCurrent
                    ? 'border-primary-500 ring-2 ring-primary-100 dark:ring-primary-900/30'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">{plan.name}</h2>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                  {price === 0 ? 'Free' : `GHS ${price.toFixed(2)}`}
                  {price > 0 && <span className="text-sm font-normal text-gray-400">/month</span>}
                </p>
                {momo && months > 1 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    GHS {(price * months).toFixed(2)} for {months} months
                  </p>
                )}
                <ul className="mt-4 space-y-1.5 flex-1">
                  {planFeatureList(plan).map((f) => (
                    <li key={f} className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-500 shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => void handleSelect(plan)}
                  disabled={isCurrent || selectingId === plan.id}
                  className={`mt-5 w-full py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
                    isCurrent
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                      : 'bg-primary-600 hover:bg-primary-700 text-white'
                  }`}
                >
                  {buttonLabel}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
