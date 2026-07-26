import { env } from '../config/env';

/**
 * Normalizes a phone number to E.164 (+<countrycode><number>).
 * Accepts local formats like "0244123456" (prepends DEFAULT_COUNTRY_CODE)
 * as well as numbers already in international form ("+233244123456",
 * "233244123456"). Returns null if the result isn't a plausible E.164 number.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\s-]/g, '');

  let digits: string;
  if (trimmed.startsWith('+')) {
    digits = trimmed.slice(1);
  } else if (trimmed.startsWith('0')) {
    digits = `${env.DEFAULT_COUNTRY_CODE}${trimmed.slice(1)}`;
  } else {
    digits = trimmed;
  }

  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}

export function isValidPhone(raw: string): boolean {
  return normalizePhone(raw) !== null;
}
