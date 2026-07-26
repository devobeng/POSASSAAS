import { env } from '../config/env';

// Hubtel OTP API — request/verify OTP delivery over SMS. Hubtel owns OTP
// generation, delivery and matching; we only hold onto the requestId/prefix
// it hands back. Auth is HTTP Basic with the Hubtel Client Id/Secret (the
// same credential pair used for Hubtel's other APIs).
//
// NOTE: exact field names below follow Hubtel's published OTP API shape at
// the time of writing. If Hubtel returns a different payload for your
// account, this is the only file that needs to change — the base URL is
// also overridable via HUBTEL_OTP_BASE_URL without a code change.

interface HubtelOtpSendResponse {
  requestId: string;
  prefix?: string;
  message?: string;
  responseCode: string;
}

interface HubtelOtpVerifyResponse {
  message?: string;
  responseCode: string;
}

const SUCCESS_CODE = '0000';

function authHeader(): string {
  const token = Buffer.from(`${env.HUBTEL_CLIENT_ID}:${env.HUBTEL_CLIENT_SECRET}`).toString(
    'base64',
  );
  return `Basic ${token}`;
}

async function hubtelRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!env.HUBTEL_CLIENT_ID || !env.HUBTEL_CLIENT_SECRET) {
    throw new Error('Hubtel is not configured (HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET missing)');
  }

  const res = await fetch(`${env.HUBTEL_OTP_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as T & { message?: string };
  if (!res.ok) {
    throw new Error(data.message ?? `Hubtel OTP request failed: ${res.status}`);
  }
  return data;
}

export interface OtpSendResult {
  requestId: string;
  prefix?: string;
}

/** Sends an OTP SMS to `phone` (E.164, e.g. "+233244123456"). */
export async function sendOtp(phone: string): Promise<OtpSendResult> {
  const data = await hubtelRequest<HubtelOtpSendResponse>('/send', {
    senderID: env.HUBTEL_SENDER_ID,
    phoneNumber: phone,
  });

  if (data.responseCode !== SUCCESS_CODE) {
    throw new Error(data.message ?? 'Failed to send OTP');
  }

  return { requestId: data.requestId, prefix: data.prefix };
}

/** Verifies a user-entered code against Hubtel's OTP session. */
export async function verifyOtp(params: {
  requestId: string;
  otpCode: string;
  prefix?: string;
}): Promise<boolean> {
  const data = await hubtelRequest<HubtelOtpVerifyResponse>('/verify', {
    requestId: params.requestId,
    otpCode: params.otpCode,
    ...(params.prefix && { prefix: params.prefix }),
  });

  return data.responseCode === SUCCESS_CODE;
}
