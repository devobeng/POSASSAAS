import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import * as reportsController from './reports.controller';

export const reportsRouter = Router();

reportsRouter.use(authenticate);

const allRoles = ['CASHIER', 'BRANCH_MANAGER', 'STORE_ADMIN', 'SUPER_ADMIN'] as const;
const managerPlus = ['BRANCH_MANAGER', 'STORE_ADMIN', 'SUPER_ADMIN'] as const;
const adminPlus = ['STORE_ADMIN', 'SUPER_ADMIN'] as const;

reportsRouter.get('/sales-summary',          authorize(...allRoles),    reportsController.salesSummary);
reportsRouter.get('/sales-by-product',       authorize(...allRoles),    reportsController.salesByProduct);
reportsRouter.get('/sales-by-category',      authorize(...allRoles),    reportsController.salesByCategory);
reportsRouter.get('/sales-by-cashier',       authorize(...managerPlus), reportsController.salesByCashier);
reportsRouter.get('/sales-by-branch',        authorize(...adminPlus),   reportsController.salesByBranch);
reportsRouter.get('/payment-methods',        authorize(...allRoles),    reportsController.paymentMethodsBreakdown);
reportsRouter.get('/inventory-valuation',    authorize(...managerPlus), reportsController.inventoryValuation);
reportsRouter.get('/profit',                 authorize(...allRoles),    reportsController.profit);
reportsRouter.get('/profit-and-loss',        authorize(...managerPlus), reportsController.profitAndLoss);
reportsRouter.get('/expenses-summary',       authorize(...managerPlus), reportsController.expensesSummary);
reportsRouter.get('/dashboard',              authorize(...allRoles),    reportsController.dashboard);
