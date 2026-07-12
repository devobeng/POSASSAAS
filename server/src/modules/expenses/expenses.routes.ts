import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { tenantScope } from '../../middleware/tenant';
import { upload } from '../../middleware/upload';
import * as ctrl from './expenses.controller';

export const expensesRouter = Router();

expensesRouter.use(authenticate, tenantScope);

const adminPlus   = ['STORE_ADMIN', 'SUPER_ADMIN'] as const;
const managerPlus = ['BRANCH_MANAGER', 'STORE_ADMIN', 'SUPER_ADMIN'] as const;

// ─── Expense Categories (STORE_ADMIN only) ────────────────────────────────────
expensesRouter.get(  '/categories',     authorize(...managerPlus), ctrl.listCategories);
expensesRouter.post( '/categories',     authorize(...adminPlus),   ctrl.createCategory);
expensesRouter.patch('/categories/:id', authorize(...adminPlus),   ctrl.updateCategory);
expensesRouter.delete('/categories/:id', authorize(...adminPlus),  ctrl.deleteCategory);

// ─── Expenses ─────────────────────────────────────────────────────────────────
expensesRouter.get(  '/',               authorize(...managerPlus), ctrl.listExpenses);
expensesRouter.post( '/',               authorize(...managerPlus), ctrl.createExpense);
expensesRouter.get(  '/:id',            authorize(...managerPlus), ctrl.getExpense);
expensesRouter.patch('/:id',            authorize(...managerPlus), ctrl.updateExpense);
expensesRouter.delete('/:id',           authorize(...managerPlus), ctrl.deleteExpense);

// ─── Receipt upload ───────────────────────────────────────────────────────────
expensesRouter.post('/:id/receipt',     authorize(...managerPlus), upload.single('receipt'), ctrl.uploadReceipt);

// ─── Approval / rejection (STORE_ADMIN only) ──────────────────────────────────
expensesRouter.post('/:id/approve',     authorize(...adminPlus),   ctrl.approveExpense);
expensesRouter.post('/:id/reject',      authorize(...adminPlus),   ctrl.rejectExpense);
