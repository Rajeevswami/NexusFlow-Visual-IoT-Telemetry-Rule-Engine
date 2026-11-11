import { Router } from 'express';
import {
  compileGraphHandler,
  createGraph,
  deactivateGraphHandler,
  deleteGraph,
  getGraph,
  listActiveGraphs,
  listGraphs,
  testGraphHandler,
  updateGraph,
  validateGraphJson,
} from '../controllers/graphController.js';
import { asyncHandler, validate } from '../middleware/validate.js';
import { graphIdSchema, graphSchema } from '../validation/graph.js';
import { rawGraphSchema, testGraphSchema } from '../validation/compile.js';

const router = Router();

// Static paths must be declared BEFORE "/:id" so they are not captured by the param route.
router.route('/active').get(asyncHandler(listActiveGraphs));
router.route('/validate').post(validate(rawGraphSchema), asyncHandler(validateGraphJson));

router.route('/')
  .post(validate(graphSchema), asyncHandler(createGraph))
  .get(asyncHandler(listGraphs));

// All "/:id" routes share the ObjectId param check.
const byId = router.route('/:id').all(validate(graphIdSchema, 'params'));
byId.get(asyncHandler(getGraph))
  .put(validate(graphSchema), asyncHandler(updateGraph))
  .delete(asyncHandler(deleteGraph));

router.route('/:id/compile').all(validate(graphIdSchema, 'params')).post(asyncHandler(compileGraphHandler));
router.route('/:id/deactivate').all(validate(graphIdSchema, 'params')).post(asyncHandler(deactivateGraphHandler));
router.route('/:id/test')
  .all(validate(graphIdSchema, 'params'))
  .post(validate(testGraphSchema), asyncHandler(testGraphHandler));

export default router;
