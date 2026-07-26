import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface JwtPayload {
  sub: string;
  email?: string;
  role: string;
  storeId?: string;
  branchId?: string;
}

export interface PasswordResetTokenPayload {
  sub: string; // userId
  resetRequestId: string; // PasswordResetRequest.id
  purpose: 'sms_password_reset';
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function signRefreshToken(payload: Pick<JwtPayload, 'sub'>): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
}

export function verifyRefreshToken(token: string): Pick<JwtPayload, 'sub'> {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as Pick<JwtPayload, 'sub'>;
}

/** Short-lived token proving a user completed SMS OTP verification, used to
 *  bridge the "verify OTP" step to "set new password" without re-sending
 *  the OTP or trusting the client to supply its own userId. */
export function signPasswordResetToken(payload: Omit<PasswordResetTokenPayload, 'purpose'>): string {
  return jwt.sign({ ...payload, purpose: 'sms_password_reset' }, env.JWT_ACCESS_SECRET, {
    expiresIn: '10m',
  });
}

export function verifyPasswordResetToken(token: string): PasswordResetTokenPayload {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as PasswordResetTokenPayload;
  if (payload.purpose !== 'sms_password_reset') {
    throw new Error('Invalid token purpose');
  }
  return payload;
}
