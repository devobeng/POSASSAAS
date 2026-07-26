import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import * as plansController from './plans.controller';

export const plansRouter = Router();

plansRouter.get('/', authenticate, plansController.getPlans);
