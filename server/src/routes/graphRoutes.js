import { Router } from 'express';
import { createGraph, deleteGraph, getGraph, listGraphs, updateGraph } from '../controllers/graphController.js';
import { asyncHandler, validate } from '../middleware/validate.js';
import { graphIdSchema, graphSchema } from '../validation/graph.js';

const router = Router();
router.route('/').post(validate(graphSchema), asyncHandler(createGraph)).get(asyncHandler(listGraphs));
router.route('/:id')
  .all(validate(graphIdSchema, 'params'))
  .get(asyncHandler(getGraph))
  .put(validate(graphSchema), asyncHandler(updateGraph))
  .delete(asyncHandler(deleteGraph));
export default router;
