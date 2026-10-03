/** Rounds to the nearest cent/pesewa (2 decimal places) — money columns are
 *  `Decimal(12,2)`, so intermediate JS `Number` math (tax, totals) must round
 *  to that precision, not to the nearest whole currency unit. */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}
