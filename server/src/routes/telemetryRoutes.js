import { Router } from 'express';
import { getReadings, ingestBatch, ingestReading } from '../controllers/telemetryController.js';
import { asyncHandler, validate } from '../middleware/validate.js';
import { batchSchema, readingSchema, telemetryQuerySchema } from '../validation/telemetry.js';

const router = Router();
router.post('/', validate(readingSchema), asyncHandler(ingestReading));
router.post('/batch', validate(batchSchema), asyncHandler(ingestBatch));
router.get('/', validate(telemetryQuerySchema, 'query'), asyncHandler(getReadings));
export default router;
