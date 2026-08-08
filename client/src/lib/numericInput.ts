import type { KeyboardEvent } from 'react';

// Native <input type="number"> still lets you type 'e'/'E' (scientific
// notation) and a leading '+' — valid per the HTML spec, meaningless for
// prices/quantities. Attach to onKeyDown to block those, plus '-'/'.' where
// the field doesn't make sense negative/fractional.
export function blockInvalidNumberKey(
  e: KeyboardEvent<HTMLInputElement>,
  opts: { allowNegative?: boolean; allowDecimal?: boolean } = {},
) {
  const { allowNegative = false, allowDecimal = true } = opts;
  if (e.key === 'e' || e.key === 'E' || e.key === '+') {
    e.preventDefault();
    return;
  }
  if (e.key === '-' && !allowNegative) {
    e.preventDefault();
    return;
  }
  if (e.key === '.' && !allowDecimal) {
    e.preventDefault();
  }
}
