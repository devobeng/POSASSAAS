import {
  PrismaClient,
  Role,
  SubscriptionStatus,
  StockMovementType,
  ExpenseStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...\n');

  // ── 1. Subscription Plans ──────────────────────────────────────────────────
  const [freePlan, basicPlan, proPlan] = await Promise.all([
    prisma.subscriptionPlan.upsert({
      where: { name: 'Free' },
      update: {},
      create: {
        name: 'Free',
        price: 0,
        maxBranches: 1,
        maxUsers: 3,
        features: { inventory: true, orders: true, reports: false, analytics: false },
      },
    }),
    prisma.subscriptionPlan.upsert({
      where: { name: 'Basic' },
      update: {},
      create: {
        name: 'Basic',
        price: 9.99,
        maxBranches: 2,
        maxUsers: 10,
        features: { inventory: true, orders: true, reports: true, analytics: false },
      },
    }),
    prisma.subscriptionPlan.upsert({
      where: { name: 'Pro' },
      update: {},
      create: {
        name: 'Pro',
        price: 29.99,
        maxBranches: 10,
        maxUsers: 50,
        features: {
          inventory: true,
          orders: true,
          reports: true,
          analytics: true,
          multiBranch: true,
          apiAccess: true,
        },
      },
    }),
  ]);

  console.log('✅ Subscription plans seeded');

  // ── 2. Super Admin (platform-level, no store) ──────────────────────────────
  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@pos.com' },
    update: {},
    create: {
      email: 'superadmin@pos.com',
      password: await bcrypt.hash('SuperAdmin@123', 12),
      name: 'Super Admin',
      role: Role.SUPER_ADMIN,
    },
  });

  console.log('✅ Super admin seeded');

  // ── 3. Demo Store ──────────────────────────────────────────────────────────
  const store = await prisma.store.upsert({
    where: { slug: 'demo-store' },
    update: {},
    create: {
      name: 'Demo Retail Store',
      slug: 'demo-store',
      currency: 'NGN',
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      subscriptionPlanId: proPlan.id,
    },
  });

  console.log('✅ Demo store seeded');

  // ── 4. Branches ────────────────────────────────────────────────────────────
  const [mainBranch, ikejaB] = await Promise.all([
    prisma.branch.upsert({
      where: { storeId_name: { storeId: store.id, name: 'Main Branch' } },
      update: {},
      create: {
        storeId: store.id,
        name: 'Main Branch',
        address: '12 Broad Street, Lagos Island, Lagos',
        phone: '+234-800-000-0001',
      },
    }),
    prisma.branch.upsert({
      where: { storeId_name: { storeId: store.id, name: 'Ikeja Branch' } },
      update: {},
      create: {
        storeId: store.id,
        name: 'Ikeja Branch',
        address: '45 Allen Avenue, Ikeja, Lagos',
        phone: '+234-800-000-0002',
      },
    }),
  ]);

  console.log('✅ Branches seeded');

  // ── 5. Users (one per role) ────────────────────────────────────────────────
  const [storeAdmin, branchManager, cashier] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@demo-store.com' },
      update: {},
      create: {
        email: 'admin@demo-store.com',
        password: await bcrypt.hash('StoreAdmin@123', 12),
        name: 'Store Admin',
        role: Role.STORE_ADMIN,
        storeId: store.id,
      },
    }),
    prisma.user.upsert({
      where: { email: 'manager@demo-store.com' },
      update: {},
      create: {
        email: 'manager@demo-store.com',
        password: await bcrypt.hash('Manager@123', 12),
        name: 'Branch Manager',
        role: Role.BRANCH_MANAGER,
        storeId: store.id,
        branchId: mainBranch.id,
      },
    }),
    prisma.user.upsert({
      where: { email: 'cashier@demo-store.com' },
      update: {},
      create: {
        email: 'cashier@demo-store.com',
        password: await bcrypt.hash('Cashier@123', 12),
        name: 'Jane Cashier',
        role: Role.CASHIER,
        storeId: store.id,
        branchId: mainBranch.id,
      },
    }),
  ]);

  console.log('✅ Users seeded');

  // ── 6. Categories ──────────────────────────────────────────────────────────
  const [electronics, beverages, snacks, stationery] = await Promise.all([
    prisma.category.upsert({
      where: { storeId_name: { storeId: store.id, name: 'Electronics' } },
      update: {},
      create: { storeId: store.id, name: 'Electronics' },
    }),
    prisma.category.upsert({
      where: { storeId_name: { storeId: store.id, name: 'Beverages' } },
      update: {},
      create: { storeId: store.id, name: 'Beverages' },
    }),
    prisma.category.upsert({
      where: { storeId_name: { storeId: store.id, name: 'Snacks' } },
      update: {},
      create: { storeId: store.id, name: 'Snacks' },
    }),
    prisma.category.upsert({
      where: { storeId_name: { storeId: store.id, name: 'Stationery' } },
      update: {},
      create: { storeId: store.id, name: 'Stationery' },
    }),
  ]);

  console.log('✅ Categories seeded');

  // ── 7. Products ────────────────────────────────────────────────────────────
  const productDefs = [
    { categoryId: electronics.id, name: 'USB-C Charger 65W',    sku: 'ELEC-001', barcode: '1000000000001', costPrice: 1500, sellingPrice: 2500, taxRate: 7.5 },
    { categoryId: electronics.id, name: 'Wireless Earbuds',      sku: 'ELEC-002', barcode: '1000000000002', costPrice: 5000, sellingPrice: 8500, taxRate: 7.5 },
    { categoryId: electronics.id, name: 'Phone Stand Adjustable',sku: 'ELEC-003', barcode: '1000000000003', costPrice: 800,  sellingPrice: 1500, taxRate: 7.5 },
    { categoryId: beverages.id,   name: 'Mineral Water 1.5L',   sku: 'BEV-001',  barcode: '1000000000004', costPrice: 150,  sellingPrice: 300,  taxRate: 0 },
    { categoryId: beverages.id,   name: 'Coca-Cola 50cl',        sku: 'BEV-002',  barcode: '1000000000005', costPrice: 200,  sellingPrice: 400,  taxRate: 0 },
    { categoryId: beverages.id,   name: 'Malta Guinness 33cl',   sku: 'BEV-003',  barcode: '1000000000006', costPrice: 250,  sellingPrice: 450,  taxRate: 0 },
    { categoryId: snacks.id,      name: 'Pringles Original 149g',sku: 'SNK-001',  barcode: '1000000000007', costPrice: 800,  sellingPrice: 1200, taxRate: 0 },
    { categoryId: snacks.id,      name: 'Digestive Biscuits',    sku: 'SNK-002',  barcode: '1000000000008', costPrice: 400,  sellingPrice: 700,  taxRate: 0 },
    { categoryId: stationery.id,  name: 'Ballpoint Pen (pack 12)',sku: 'STA-001', barcode: '1000000000009', costPrice: 300,  sellingPrice: 600,  taxRate: 0 },
    { categoryId: stationery.id,  name: 'A4 Notebook 200pg',     sku: 'STA-002',  barcode: '1000000000010', costPrice: 500,  sellingPrice: 900,  taxRate: 0 },
  ];

  const products = await Promise.all(
    productDefs.map((p) =>
      prisma.product.upsert({
        where: { storeId_sku: { storeId: store.id, sku: p.sku } },
        update: {},
        create: { storeId: store.id, ...p },
      }),
    ),
  );

  console.log('✅ Products seeded');

  // ── 8. Inventory per branch + opening stock movements ─────────────────────
  const branches = [mainBranch, ikejaB];
  const branchQty: Record<string, number> = {
    [mainBranch.id]: 50,
    [ikejaB.id]: 30,
  };

  for (const product of products) {
    for (const branch of branches) {
      const qty = branchQty[branch.id];
      const item = await prisma.inventoryItem.upsert({
        where: { productId_branchId: { productId: product.id, branchId: branch.id } },
        update: { quantity: qty },
        create: {
          productId: product.id,
          branchId: branch.id,
          quantity: qty,
          lowStockThreshold: 10,
        },
      });

      // Only create the opening-stock movement if there isn't one already
      const existing = await prisma.stockMovement.findFirst({
        where: { inventoryItemId: item.id, type: StockMovementType.PURCHASE },
      });
      if (!existing) {
        await prisma.stockMovement.create({
          data: {
            inventoryItemId: item.id,
            type: StockMovementType.PURCHASE,
            quantity: qty,
            note: 'Opening stock',
            userId: superAdmin.id,
          },
        });
      }
    }
  }

  console.log('✅ Inventory seeded');

  // ── 9. Expense categories (defaults per store) ─────────────────────────────
  const DEFAULT_EXPENSE_CATEGORIES = [
    'Rent', 'Utilities', 'Salaries', 'Supplies',
    'Transport', 'Marketing', 'Maintenance', 'Other',
  ];

  await prisma.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
      storeId: store.id,
      name,
      isDefault: true,
    })),
    skipDuplicates: true,
  });

  // Fetch them back for use in sample expenses
  const expCats = await prisma.expenseCategory.findMany({ where: { storeId: store.id } });
  const catByName = Object.fromEntries(expCats.map((c) => [c.name, c]));

  console.log('✅ Expense categories seeded');

  // ── 10. Sample expenses (fixture data for P&L tests) ──────────────────────
  const thisMonth = new Date();
  thisMonth.setDate(1);

  const sampleExpenses = [
    { category: 'Rent',        amount: 15000000, branch: mainBranch, status: ExpenseStatus.APPROVED, daysAgo: 25 },
    { category: 'Utilities',   amount:  3500000, branch: mainBranch, status: ExpenseStatus.APPROVED, daysAgo: 20 },
    { category: 'Salaries',    amount: 45000000, branch: mainBranch, status: ExpenseStatus.APPROVED, daysAgo: 15 },
    { category: 'Supplies',    amount:  1200000, branch: ikejaB,     status: ExpenseStatus.APPROVED, daysAgo: 10 },
    { category: 'Marketing',   amount:  2500000, branch: mainBranch, status: ExpenseStatus.APPROVED, daysAgo:  5 },
    { category: 'Transport',   amount:   800000, branch: ikejaB,     status: ExpenseStatus.PENDING,  daysAgo:  3 },
    { category: 'Maintenance', amount:   500000, branch: mainBranch, status: ExpenseStatus.REJECTED, daysAgo:  2 },
  ];

  for (const e of sampleExpenses) {
    const cat = catByName[e.category];
    if (!cat) continue;
    const expDate = new Date();
    expDate.setDate(expDate.getDate() - e.daysAgo);

    const existing = await prisma.expense.findFirst({
      where: { storeId: store.id, categoryId: cat.id, amount: e.amount, branchId: e.branch.id },
    });
    if (existing) continue;

    await prisma.expense.create({
      data: {
        storeId:     store.id,
        branchId:    e.branch.id,
        categoryId:  cat.id,
        amount:      e.amount,
        description: `${e.category} — demo seed`,
        expenseDate: expDate,
        recordedById: branchManager.id,
        status:       e.status,
        approvedById: e.status === ExpenseStatus.APPROVED ? storeAdmin.id : null,
      },
    });
  }

  console.log('✅ Sample expenses seeded\n');

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Demo credentials:');
  console.log('  SUPER_ADMIN    → superadmin@pos.com     / SuperAdmin@123');
  console.log('  STORE_ADMIN    → admin@demo-store.com   / StoreAdmin@123');
  console.log('  BRANCH_MANAGER → manager@demo-store.com / Manager@123');
  console.log('  CASHIER        → cashier@demo-store.com / Cashier@123');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n🎉 Seed complete!');

  // Keep TypeScript happy — these are used in the seed but TS may warn about unused imports
  void [freePlan, basicPlan, storeAdmin, branchManager, cashier, stationery];
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
