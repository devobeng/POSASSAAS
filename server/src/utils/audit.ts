import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from './logger';

interface AuditData {
  storeId?: string | null;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

/** Fire-and-forget audit log write. Never throws — a failed audit must not fail the request. */
export async function auditLog(data: AuditData): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        storeId: data.storeId ?? null,
        userId: data.userId,
        action: data.action,
        entity: data.entity,
        entityId: data.entityId,
        // Record<string, unknown> is runtime-safe JSON but doesn't satisfy Prisma's
        // narrow InputJsonValue type — the double cast is intentional.
        ...(data.metadata !== undefined && {
          metadata: data.metadata as unknown as Prisma.InputJsonValue,
        }),
      },
    });
  } catch (err) {
    logger.error('AuditLog write failed', err);
  }
}
