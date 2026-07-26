import type { Request, Response } from 'express';
import { prisma } from '../../config/database';
import { sendSuccess } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

// Read-only, any authenticated role — lets STORE_ADMIN see plan options during
// signup/upgrade without needing SUPER_ADMIN's /admin/plans CRUD access.
export const getPlans = asyncHandler(async (_req: Request, res: Response) => {
  const plans = await prisma.subscriptionPlan.findMany({
    orderBy: { price: 'asc' },
    select: {
      id: true, name: true, price: true,
      maxBranches: true, maxUsers: true, features: true,
    },
  });
  sendSuccess(res, plans);
});
