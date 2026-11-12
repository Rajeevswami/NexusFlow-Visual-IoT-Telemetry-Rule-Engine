import { Router } from 'express';
import { listAlertsHandler } from '../controllers/alertController.js';
import { asyncHandler, validate } from '../middleware/validate.js';
import { alertQuerySchema } from '../validation/alert.js';

/** Mounted at /api/alerts */
const router = Router();
router.get('/', validate(alertQuerySchema, 'query'), asyncHandler(listAlertsHandler));
export default router;
