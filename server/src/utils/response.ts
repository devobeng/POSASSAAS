import type { Response } from 'express';

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  meta?: Record<string, unknown>;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'Success',
  statusCode = 200,
  meta?: Record<string, unknown>,
): void {
  const body: ApiResponse<T> = { success: true, message, data };
  if (meta) body.meta = meta;
  res.status(statusCode).json(body);
}

export function sendError(res: Response, message: string, statusCode = 400, errors?: unknown): void {
  const body: ApiResponse<null> = { success: false, message };
  if (errors) (body as unknown as Record<string, unknown>).errors = errors;
  res.status(statusCode).json(body);
}
