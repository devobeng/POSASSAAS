import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error';
import { auditLog } from '../../utils/audit';
import type { CreateCategoryInput, UpdateCategoryInput } from './categories.schema';

export async function getCategories(storeId: string) {
  return prisma.category.findMany({
    where: { storeId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  });
}

export async function getCategory(storeId: string, categoryId: string) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, storeId },
    include: { _count: { select: { products: true } } },
  });
  if (!category) throw new AppError('Category not found', 404);
  return category;
}

export async function createCategory(
  storeId: string,
  data: CreateCategoryInput,
  actorId: string,
) {
  const category = await prisma.category.create({
    data: { storeId, name: data.name },
    include: { _count: { select: { products: true } } },
  });
  await auditLog({
    storeId,
    userId: actorId,
    action: 'CREATE',
    entity: 'Category',
    entityId: category.id,
    metadata: { name: category.name },
  });
  return category;
}

export async function updateCategory(
  storeId: string,
  categoryId: string,
  data: UpdateCategoryInput,
  actorId: string,
) {
  const existing = await prisma.category.findFirst({
    where: { id: categoryId, storeId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Category not found', 404);

  const category = await prisma.category.update({
    where: { id: categoryId },
    data,
    include: { _count: { select: { products: true } } },
  });
  await auditLog({
    storeId,
    userId: actorId,
    action: 'UPDATE',
    entity: 'Category',
    entityId: categoryId,
    metadata: { fields: Object.keys(data) },
  });
  return category;
}

export async function deleteCategory(
  storeId: string,
  categoryId: string,
  actorId: string,
) {
  const existing = await prisma.category.findFirst({
    where: { id: categoryId, storeId },
    select: { id: true, _count: { select: { products: true } } },
  });
  if (!existing) throw new AppError('Category not found', 404);
  if (existing._count.products > 0) {
    throw new AppError(
      `Cannot delete a category that has ${existing._count.products} product(s). Reassign them first.`,
      409,
    );
  }

  await prisma.category.delete({ where: { id: categoryId } });
  await auditLog({
    storeId,
    userId: actorId,
    action: 'DELETE',
    entity: 'Category',
    entityId: categoryId,
  });
}
