import { Router } from 'express';
import { getTemplates } from '../data/templates.js';
const router = Router();
router.get('/', (req, res) => res.json({ data: getTemplates() }));
export default router;
