import { Router } from 'express';
import { getReadings, getTelemetryStats, ingestBatch, ingestReading } from '../controllers/telemetryController.js';
import { asyncHandler, validate } from '../middleware/validate.js';
import { batchSchema, readingSchema, statsQuerySchema, telemetryQuerySchema } from '../validation/telemetry.js';

const router = Router();
// Static paths must be declared BEFORE "/" so they are not captured by the param route.
router.get('/stats', validate(statsQuerySchema, 'query'), asyncHandler(getTelemetryStats));
router.post('/', validate(readingSchema), asyncHandler(ingestReading));
router.post('/batch', validate(batchSchema), asyncHandler(ingestBatch));
router.get('/', validate(telemetryQuerySchema, 'query'), asyncHandler(getReadings));
export default router;
