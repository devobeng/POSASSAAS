import type { Request, Response } from 'express';
import * as productsService from './products.service';
import { sendSuccess } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../middleware/error';
import type { CreateProductInput, UpdateProductInput, ProductListQuery } from './products.schema';

export const getProducts = asyncHandler(async (req: Request, res: Response) => {
  const result = await productsService.getProducts(
    req.storeId!,
    req.query as unknown as ProductListQuery,
  );
  sendSuccess(res, result.products, 'Success', 200, {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
});

export const getProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.getProduct(req.storeId!, req.params.id);
  sendSuccess(res, product);
});

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.createProduct(
    req.storeId!,
    req.body as CreateProductInput,
    req.user!.sub,
  );
  sendSuccess(res, product, 'Product created', 201);
});

export const updateProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.updateProduct(
    req.storeId!,
    req.params.id,
    req.body as UpdateProductInput,
    req.user!.sub,
  );
  sendSuccess(res, product, 'Product updated');
});

export const uploadProductImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new AppError('No image file uploaded', 400);
  const product = await productsService.uploadProductImage(
    req.storeId!,
    req.params.id,
    req.file.buffer,
    req.user!.sub,
  );
  sendSuccess(res, product, 'Image uploaded');
});

export const deleteProduct = asyncHandler(async (req: Request, res: Response) => {
  await productsService.deleteProduct(req.storeId!, req.params.id, req.user!.sub);
  sendSuccess(res, null, 'Product deactivated');
});

export const bulkImportProducts = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new AppError('CSV file is required', 400);
  const csvContent = req.file.buffer.toString('utf-8');
  const results = await productsService.bulkImportProducts(
    req.storeId!,
    csvContent,
    req.user!.sub,
  );
  const successful = results.filter((r) => r.success).length;
  sendSuccess(res, results, `Imported ${successful} of ${results.length} rows`, 200);
});
