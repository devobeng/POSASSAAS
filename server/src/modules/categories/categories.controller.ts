import type { Request, Response } from 'express';
import * as categoriesService from './categories.service';
import { sendSuccess } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import type { CreateCategoryInput, UpdateCategoryInput } from './categories.schema';

export const getCategories = asyncHandler(async (req: Request, res: Response) => {
  const categories = await categoriesService.getCategories(req.storeId!);
  sendSuccess(res, categories);
});

export const getCategory = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoriesService.getCategory(req.storeId!, req.params.id);
  sendSuccess(res, category);
});

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoriesService.createCategory(
    req.storeId!,
    req.body as CreateCategoryInput,
    req.user!.sub,
  );
  sendSuccess(res, category, 'Category created', 201);
});

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoriesService.updateCategory(
    req.storeId!,
    req.params.id,
    req.body as UpdateCategoryInput,
    req.user!.sub,
  );
  sendSuccess(res, category, 'Category updated');
});

export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  await categoriesService.deleteCategory(req.storeId!, req.params.id, req.user!.sub);
  sendSuccess(res, null, 'Category deleted');
});
