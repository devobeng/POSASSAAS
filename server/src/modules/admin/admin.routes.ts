import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { subscriptionPlanSchema, getStoresQuerySchema } from './admin.schema';
import * as adminController from './admin.controller';

export const adminRouter = Router();

adminRouter.use(authenticate, authorize('SUPER_ADMIN'));

// Platform store management
adminRouter.get('/stores', validate(getStoresQuerySchema, 'query'), adminController.getStores);
adminRouter.post('/stores/:id/suspend', adminController.suspendStore);
adminRouter.post('/stores/:id/activate', adminController.activateStore);
adminRouter.get('/stats', adminController.getPlatformStats);

// Subscription plan CRUD
adminRouter.get('/plans', adminController.getPlans);
adminRouter.post('/plans', validate(subscriptionPlanSchema), adminController.createPlan);
adminRouter.patch('/plans/:id', validate(subscriptionPlanSchema.partial()), adminController.updatePlan);
adminRouter.delete('/plans/:id', adminController.deletePlan);
