import { Router } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../../middleware/auth';
import { tenantScope } from '../../middleware/tenant';
import { validate } from '../../middleware/validate';
import { upload } from '../../middleware/upload';
import {
  createProductSchema,
  updateProductSchema,
  productListQuerySchema,
} from './products.schema';
import * as productsController from './products.controller';

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isCSV =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.toLowerCase().endsWith('.csv');
    if (isCSV) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed for bulk import'));
    }
  },
});

export const productsRouter = Router();

productsRouter.use(authenticate, authorize('STORE_ADMIN', 'SUPER_ADMIN'), tenantScope);

productsRouter.get('/', validate(productListQuerySchema, 'query'), productsController.getProducts);
productsRouter.get('/:id', productsController.getProduct);
productsRouter.post('/', validate(createProductSchema), productsController.createProduct);
productsRouter.patch('/:id', validate(updateProductSchema), productsController.updateProduct);
productsRouter.delete('/:id', productsController.deleteProduct);
productsRouter.post(
  '/:id/image',
  upload.single('image'),
  productsController.uploadProductImage,
);
productsRouter.post(
  '/import',
  csvUpload.single('file'),
  productsController.bulkImportProducts,
);
