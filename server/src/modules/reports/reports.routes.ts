import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { requireFeature } from '../../middleware/subscription';
import * as reportsController from './reports.controller';

export const reportsRouter = Router();

reportsRouter.use(authenticate);

const allRoles = ['CASHIER', 'BRANCH_MANAGER', 'STORE_ADMIN', 'SUPER_ADMIN'] as const;
const managerPlus = ['BRANCH_MANAGER', 'STORE_ADMIN', 'SUPER_ADMIN'] as const;
const adminPlus = ['STORE_ADMIN', 'SUPER_ADMIN'] as const;

const reports = requireFeature('reports');
const analytics = requireFeature('analytics');
const multiBranch = requireFeature('multiBranch');

// Home-screen KPIs — always available regardless of plan.
reportsRouter.get('/dashboard', authorize(...allRoles), reportsController.dashboard);

// Basic reporting — requires the 'reports' feature (Free plan lacks it).
reportsRouter.get('/sales-summary',    authorize(...allRoles),    reports, reportsController.salesSummary);
reportsRouter.get('/sales-by-product', authorize(...allRoles),    reports, reportsController.salesByProduct);
reportsRouter.get('/sales-by-category',authorize(...allRoles),    reports, reportsController.salesByCategory);
reportsRouter.get('/sales-by-cashier', authorize(...managerPlus), reports, reportsController.salesByCashier);
reportsRouter.get('/payment-methods',  authorize(...allRoles),    reports, reportsController.paymentMethodsBreakdown);
reportsRouter.get('/expenses-summary', authorize(...managerPlus), reports, reportsController.expensesSummary);

// Deeper financial analytics — requires the 'analytics' feature (Pro only).
reportsRouter.get('/inventory-valuation', authorize(...managerPlus), analytics, reportsController.inventoryValuation);
reportsRouter.get('/profit',              authorize(...allRoles),    analytics, reportsController.profit);
reportsRouter.get('/profit-and-loss',     authorize(...managerPlus), analytics, reportsController.profitAndLoss);

// Cross-branch comparison — requires the 'multiBranch' feature (Pro only).
reportsRouter.get('/sales-by-branch', authorize(...adminPlus), multiBranch, reportsController.salesByBranch);
