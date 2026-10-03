import { env } from '../config/env';

/** True when `url`'s origin is one this app actually serves the frontend
 *  from — the same allowlist app.ts's CORS check uses (CLIENT_URL exactly,
 *  plus any localhost port outside production). Used wherever a
 *  caller-supplied URL is later handed to a third party (e.g. Paystack's
 *  post-checkout redirect) that will send an end user there directly —
 *  without this, that URL is an open redirect any authenticated user could
 *  point at a phishing page right after a real payment completes. */
export function isAllowedRedirectUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin === new URL(env.CLIENT_URL).origin) return true;
  if (env.NODE_ENV !== 'production' && /^localhost$/.test(parsed.hostname)) return true;
  return false;
}
