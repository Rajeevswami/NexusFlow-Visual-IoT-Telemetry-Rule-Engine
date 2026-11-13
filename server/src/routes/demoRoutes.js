import { Router } from 'express';
import { demoStatus, startDemo, stopDemo } from '../services/demoService.js';
import { asyncHandler, validate } from '../middleware/validate.js';
import { demoStartSchema } from '../validation/deliveries.js';
const router = Router();
router.get('/status', (req, res) => res.json({ data: demoStatus() }));
router.post('/start', validate(demoStartSchema), asyncHandler(async (req, res) => res.json({ data: await startDemo(res.locals.validated.body) })));
router.post('/stop', asyncHandler(async (req, res) => res.json({ data: await stopDemo() })));
export default router;
