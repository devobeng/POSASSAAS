import type { Request, Response } from 'express';
import * as branchService from './branches.service';
import { sendSuccess } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import type { CreateBranchInput, UpdateBranchInput } from './branches.schema';

export const getBranches = asyncHandler(async (req: Request, res: Response) => {
  const branches = await branchService.getBranches(
    req.storeId!,
    req.user!.role,
    req.user!.branchId,
  );
  sendSuccess(res, branches);
});

export const getBranch = asyncHandler(async (req: Request, res: Response) => {
  const branch = await branchService.getBranch(
    req.storeId!,
    req.params.id,
    req.user!.role,
    req.user!.branchId,
  );
  sendSuccess(res, branch);
});

export const createBranch = asyncHandler(async (req: Request, res: Response) => {
  const branch = await branchService.createBranch(
    req.storeId!,
    req.body as CreateBranchInput,
    req.user!.sub,
  );
  sendSuccess(res, branch, 'Branch created', 201);
});

export const updateBranch = asyncHandler(async (req: Request, res: Response) => {
  const branch = await branchService.updateBranch(
    req.storeId!,
    req.params.id,
    req.body as UpdateBranchInput,
    req.user!.sub,
  );
  sendSuccess(res, branch, 'Branch updated');
});

export const deleteBranch = asyncHandler(async (req: Request, res: Response) => {
  await branchService.deleteBranch(req.storeId!, req.params.id, req.user!.sub);
  sendSuccess(res, null, 'Branch deactivated');
});
