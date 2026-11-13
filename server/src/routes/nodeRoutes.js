import { Router } from 'express';
import { testNodeHandler } from '../controllers/deliveryController.js';
import { asyncHandler, validate } from '../middleware/validate.js';
import { nodeTestSchema } from '../validation/deliveries.js';
const router = Router();
router.post('/test', validate(nodeTestSchema), asyncHandler(testNodeHandler));
export default router;
