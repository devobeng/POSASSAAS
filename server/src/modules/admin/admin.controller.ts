import type { Request, Response } from 'express';
import * as adminService from './admin.service';
import { sendSuccess } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import type { GetStoresQuery, SubscriptionPlanInput } from './admin.schema';

export const getStores = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.getStores(req.query as unknown as GetStoresQuery);
  sendSuccess(res, result.stores, 'Stores fetched', 200, result.meta);
});

export const suspendStore = asyncHandler(async (req: Request, res: Response) => {
  const store = await adminService.setStoreStatus(req.params.id, 'SUSPENDED', req.user!.sub);
  sendSuccess(
    res,
    store,
    store.billingSyncFailed
      ? 'Store suspended — but Paystack billing could not be paused; verify in the Paystack dashboard'
      : 'Store suspended',
  );
});

export const activateStore = asyncHandler(async (req: Request, res: Response) => {
  const store = await adminService.setStoreStatus(req.params.id, 'ACTIVE', req.user!.sub);
  sendSuccess(
    res,
    store,
    store.billingSyncFailed
      ? 'Store activated — but Paystack billing could not be resumed; verify in the Paystack dashboard'
      : 'Store activated',
  );
});

export const getPlatformStats = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await adminService.getPlatformStats();
  sendSuccess(res, stats);
});

export const getPlans = asyncHandler(async (_req: Request, res: Response) => {
  const plans = await adminService.getSubscriptionPlans();
  sendSuccess(res, plans);
});

export const createPlan = asyncHandler(async (req: Request, res: Response) => {
  const plan = await adminService.createSubscriptionPlan(
    req.body as SubscriptionPlanInput,
    req.user!.sub,
  );
  sendSuccess(res, plan, 'Plan created', 201);
});

export const updatePlan = asyncHandler(async (req: Request, res: Response) => {
  const plan = await adminService.updateSubscriptionPlan(
    req.params.id,
    req.body as Partial<SubscriptionPlanInput>,
    req.user!.sub,
  );
  sendSuccess(res, plan, 'Plan updated');
});

export const deletePlan = asyncHandler(async (req: Request, res: Response) => {
  await adminService.deleteSubscriptionPlan(req.params.id, req.user!.sub);
  sendSuccess(res, null, 'Plan deleted');
});
