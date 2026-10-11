import type { Request, Response, CookieOptions } from 'express';
import * as authService from './auth.service';
import { sendSuccess } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../middleware/error';
import { env } from '../../config/env';
import type {
  LoginInput,
  RegisterStoreInput,
  ForgotPasswordRequestInput,
  ForgotPasswordVerifyInput,
  ForgotPasswordResetInput,
} from './auth.schema';
// refresh token is read from the httpOnly cookie, not the request body

export const REFRESH_COOKIE = 'pos_rt';

const cookieOpts: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  // Client and API live on different onrender.com subdomains, which browsers
  // treat as cross-site (onrender.com is a public suffix) — 'strict' would
  // stop the refresh cookie being sent at all. 'none' requires secure: true.
  sameSite: env.NODE_ENV === 'production' ? 'none' : 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function clearCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { ...cookieOpts, maxAge: 0 });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export const registerStore = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.registerStore(req.body as RegisterStoreInput);
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOpts);
  sendSuccess(
    res,
    { accessToken: result.accessToken, user: result.user, store: result.store },
    'Store registered successfully',
    201,
  );
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.loginUser(req.body as LoginInput);
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOpts);
  sendSuccess(res, { accessToken: result.accessToken, user: result.user }, 'Login successful');
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies[REFRESH_COOKIE] as string | undefined;
  if (!token) throw new AppError('No refresh token', 401);
  const result = await authService.refreshTokens(token);
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOpts);
  sendSuccess(res, { accessToken: result.accessToken }, 'Tokens refreshed');
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  if (req.user) {
    await authService.logoutUser(req.user.sub);
  }
  clearCookie(res);
  sendSuccess(res, null, 'Logged out successfully');
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getMe(req.user!.sub);
  sendSuccess(res, user);
});

export const forgotPasswordRequest = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.forgotPasswordRequest(req.body as ForgotPasswordRequestInput);
  sendSuccess(res, result, 'If that number is registered, a verification code has been sent');
});

export const forgotPasswordVerify = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.verifyForgotPasswordOtp(req.body as ForgotPasswordVerifyInput);
  sendSuccess(res, result, 'Code verified');
});

export const forgotPasswordReset = asyncHandler(async (req: Request, res: Response) => {
  await authService.resetPasswordWithSmsToken(req.body as ForgotPasswordResetInput);
  sendSuccess(res, null, 'Password reset successfully');
});
