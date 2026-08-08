import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 400,
    public errors?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFound(req: Request, res: Response): void {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.errors ? { errors: err.errors } : {}),
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: err.flatten().fieldErrors,
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'File exceeds the 5 MB size limit'
        : err.message;
    res.status(status).json({ success: false, message });
    return;
  }

  // multer fileFilter errors arrive as plain Error objects
  if (err instanceof Error && err.message.includes('Only')) {
    res.status(415).json({ success: false, message: err.message });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ success: false, message: 'A record with that value already exists' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ success: false, message: 'Record not found' });
      return;
    }
    if (err.code === 'P2003') {
      res.status(409).json({ success: false, message: 'Related record not found or constraint violation' });
      return;
    }
    if (err.code === 'P2034') {
      res.status(503).json({ success: false, message: 'Transaction conflict — please retry' });
      return;
    }
    if (err.code === 'P2024') {
      // Pool exhausted under a request burst (e.g. many cashiers checking out
      // at the same branch in the same instant). Not a bug — a capacity
      // signal. 503 tells the client to retry instead of surfacing a raw 500.
      logger.warn('Prisma connection pool timeout — consider raising connection_limit or scaling out', err);
      res.status(503).json({ success: false, message: 'Server is busy — please try again' });
      return;
    }
    if (err.code === 'P2028') {
      // Interactive transaction lost its connection (PgBouncer transaction-mode).
      // Fix: use session-mode pooler (port 5432) in DATABASE_URL.
      logger.error('Prisma transaction lost — check DATABASE_URL pooler mode', err);
      res.status(503).json({ success: false, message: 'Database transaction unavailable — please retry' });
      return;
    }
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    logger.error('Database connection error', err);
    res.status(503).json({ success: false, message: 'Database unavailable — please retry' });
    return;
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    logger.error('Prisma validation error', err);
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(400).json({
      success: false,
      message: 'Invalid data sent to the database',
      ...(isDev && { debug: err.message }),
    });
    return;
  }

  logger.error('Unhandled error', err);
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    ...(isDev && { debug: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }),
  });
}
