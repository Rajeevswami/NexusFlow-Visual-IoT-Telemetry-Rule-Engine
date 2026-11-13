import { Router } from 'express';
import { listDeliveries, retryDeliveryHandler } from '../controllers/deliveryController.js';
import { asyncHandler, validate } from '../middleware/validate.js';
import { deliveryIdSchema, deliveryQuerySchema } from '../validation/deliveries.js';
const router = Router();
router.get('/', validate(deliveryQuerySchema, 'query'), asyncHandler(listDeliveries));
router.post('/:id/retry', validate(deliveryIdSchema, 'params'), asyncHandler(retryDeliveryHandler));
export default router;
