import crypto from 'crypto';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error';
import { auditLog } from '../../utils/audit';
import { uploadImage } from '../../utils/cloudinary';
import type { CreateProductInput, UpdateProductInput, ProductListQuery } from './products.schema';

// ─── Guards ───────────────────────────────────────────────────────────────────

async function assertCategoryInStore(storeId: string, categoryId: string): Promise<void> {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, storeId },
    select: { id: true },
  });
  if (!category) throw new AppError('Category not found or does not belong to this store', 404);
}

// ─── SKU generation ───────────────────────────────────────────────────────────

function makeSku(name: string): string {
  const prefix = name
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 4)
    .padEnd(4, 'X');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${suffix}`;
}

async function uniqueSku(storeId: string, name: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const sku = makeSku(name);
    const conflict = await prisma.product.findFirst({
      where: { storeId, sku },
      select: { id: true },
    });
    if (!conflict) return sku;
  }
  throw new AppError(
    'Could not generate a unique SKU — please provide one manually',
    500,
  );
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getProducts(storeId: string, query: ProductListQuery) {
  const { search, categoryId, isActive, sortBy, sortOrder, page, limit } = query;

  const where = {
    storeId,
    ...(isActive !== undefined && { isActive }),
    ...(categoryId && { categoryId }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        { sku: { contains: search, mode: 'insensitive' as const } },
        { barcode: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    products,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getProduct(storeId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, storeId },
    include: { category: { select: { id: true, name: true } } },
  });
  if (!product) throw new AppError('Product not found', 404);
  return product;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createProduct(
  storeId: string,
  data: CreateProductInput,
  actorId: string,
) {
  const sku = data.sku ?? (await uniqueSku(storeId, data.name));

  if (data.categoryId) {
    await assertCategoryInStore(storeId, data.categoryId);
  }

  const product = await prisma.product.create({
    data: {
      storeId,
      name: data.name,
      sku,
      barcode: data.barcode,
      categoryId: data.categoryId,
      costPrice: data.costPrice,
      sellingPrice: data.sellingPrice,
      taxRate: data.taxRate ?? 0,
      isActive: data.isActive ?? true,
    },
    include: { category: { select: { id: true, name: true } } },
  });

  await auditLog({
    storeId,
    userId: actorId,
    action: 'CREATE',
    entity: 'Product',
    entityId: product.id,
    metadata: { name: product.name, sku: product.sku },
  });
  return product;
}

export async function updateProduct(
  storeId: string,
  productId: string,
  data: UpdateProductInput,
  actorId: string,
) {
  const existing = await prisma.product.findFirst({
    where: { id: productId, storeId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Product not found', 404);

  if (data.categoryId) {
    await assertCategoryInStore(storeId, data.categoryId);
  }

  const product = await prisma.product.update({
    where: { id: productId },
    data,
    include: { category: { select: { id: true, name: true } } },
  });
  await auditLog({
    storeId,
    userId: actorId,
    action: 'UPDATE',
    entity: 'Product',
    entityId: productId,
    metadata: { fields: Object.keys(data) },
  });
  return product;
}

export async function uploadProductImage(
  storeId: string,
  productId: string,
  buffer: Buffer,
  actorId: string,
) {
  const existing = await prisma.product.findFirst({
    where: { id: productId, storeId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Product not found', 404);

  const imageUrl = await uploadImage(buffer, `pos/${storeId}/products`, productId);
  const product = await prisma.product.update({
    where: { id: productId },
    data: { imageUrl },
    include: { category: { select: { id: true, name: true } } },
  });
  await auditLog({
    storeId,
    userId: actorId,
    action: 'UPDATE',
    entity: 'Product',
    entityId: productId,
    metadata: { field: 'imageUrl' },
  });
  return product;
}

export async function deleteProduct(
  storeId: string,
  productId: string,
  actorId: string,
) {
  const existing = await prisma.product.findFirst({
    where: { id: productId, storeId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Product not found', 404);

  await prisma.product.update({ where: { id: productId }, data: { isActive: false } });
  await auditLog({
    storeId,
    userId: actorId,
    action: 'SOFT_DELETE',
    entity: 'Product',
    entityId: productId,
  });
}

// ─── Bulk CSV import ──────────────────────────────────────────────────────────

interface ImportRowResult {
  row: number;
  success: boolean;
  sku?: string;
  error?: string;
}

function parseValue(val: string | undefined): string {
  return (val ?? '').replace(/^["']|["']$/g, '').trim();
}

export async function bulkImportProducts(
  storeId: string,
  csvContent: string,
  actorId: string,
): Promise<ImportRowResult[]> {
  const lines = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nonEmpty = lines.filter((l) => l.trim());

  if (nonEmpty.length < 2) {
    throw new AppError('CSV must have a header row and at least one data row', 400);
  }

  const headers = nonEmpty[0].split(',').map((h) =>
    parseValue(h).toLowerCase().replace(/[\s_-]+/g, ''),
  );

  // Pre-load categories so we avoid N+1 lookups
  const categories = await prisma.category.findMany({
    where: { storeId },
    select: { id: true, name: true },
  });
  const categoryMap = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  const results: ImportRowResult[] = [];

  for (let i = 1; i < nonEmpty.length; i++) {
    const rowNum = i + 1;
    const values = nonEmpty[i].split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = parseValue(values[idx]);
    });

    try {
      const name = row['name'] ?? row['productname'];
      if (!name) throw new Error('name is required');

      const costPrice = parseFloat(row['costprice'] ?? row['cost'] ?? '');
      if (isNaN(costPrice) || costPrice < 0)
        throw new Error('costPrice must be a non-negative number');

      const sellingPrice = parseFloat(row['sellingprice'] ?? row['price'] ?? '');
      if (isNaN(sellingPrice) || sellingPrice < 0)
        throw new Error('sellingPrice must be a non-negative number');

      const taxRate = parseFloat(row['taxrate'] ?? row['tax'] ?? '0') || 0;

      const rawSku = row['sku'];
      const sku = rawSku || (await uniqueSku(storeId, name));

      // Check for SKU collision
      const conflict = await prisma.product.findFirst({
        where: { storeId, sku },
        select: { id: true },
      });
      if (conflict) throw new Error(`SKU "${sku}" already exists`);

      const categoryName = row['categoryname'] ?? row['category'];
      const categoryId = categoryName
        ? (categoryMap.get(categoryName.toLowerCase()) ?? undefined)
        : undefined;

      await prisma.product.create({
        data: {
          storeId,
          name,
          sku,
          barcode: row['barcode'] || undefined,
          categoryId,
          costPrice,
          sellingPrice,
          taxRate,
        },
      });

      results.push({ row: rowNum, success: true, sku });
    } catch (err) {
      results.push({
        row: rowNum,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  await auditLog({
    storeId,
    userId: actorId,
    action: 'BULK_IMPORT',
    entity: 'Product',
    entityId: storeId,
    metadata: {
      total: results.length,
      successful: results.filter((r) => r.success).length,
    },
  });

  return results;
}
