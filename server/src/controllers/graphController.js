import { Graph } from '../models/Graph.js';
import { compileGraph, validateGraph, GraphValidationError } from '../compiler/index.js';
import { activeGraphManager } from '../services/activeGraphManager.js';
import { broadcastGraphStatus } from '../services/websocket.js';
import { httpError } from '../utils/httpError.js';

export async function createGraph(req, res) {
  const graph = await Graph.create(res.locals.validated.body);
  res.status(201).json({ data: graph });
}

export async function listGraphs(req, res) {
  // Keep the picker response small; GET by ID returns the complete graph.
  const graphs = await Graph.find().select('name createdAt updatedAt').sort({ updatedAt: -1 }).limit(100).lean();
  res.json({ data: graphs });
}

export async function getGraph(req, res) {
  const graph = await Graph.findById(res.locals.validated.params.id).lean();
  if (!graph) return res.status(404).json({ error: { message: 'Graph not found.' } });
  return res.json({ data: graph });
}

export async function updateGraph(req, res) {
  const graph = await Graph.findByIdAndUpdate(res.locals.validated.params.id, res.locals.validated.body, {
    new: true,
    runValidators: true,
  }).lean();
  if (!graph) return res.status(404).json({ error: { message: 'Graph not found.' } });
  return res.json({ data: graph });
}

export async function deleteGraph(req, res) {
  const graph = await Graph.findByIdAndDelete(res.locals.validated.params.id).lean();
  if (!graph) return res.status(404).json({ error: { message: 'Graph not found.' } });
  return res.status(204).end();
}

/**
 * POST /api/graphs/validate — validate raw graph JSON without saving it.
 * Returns 200 with `{ valid, errors, warnings }` (a 400 is reserved for malformed bodies).
 */
export async function validateGraphJson(req, res) {
  const result = validateGraph(res.locals.validated.body);
  res.json({
    valid: result.ok,
    errors: result.errors,
    warnings: result.warnings,
    summary: { nodeCount: result.nodes.length, edgeCount: result.edges.length },
  });
}

/**
 * POST /api/graphs/:id/compile — validate + compile a saved graph and activate it.
 */
export async function compileGraphHandler(req, res) {
  const { id } = res.locals.validated.params;
  try {
    const entry = await activeGraphManager.activate(id);
    res.status(200).json({
      data: {
        graphId: entry.graphId,
        name: entry.name,
        nodeCount: entry.nodeCount,
        edgeCount: entry.edgeCount,
        sources: entry.sources,
        warnings: entry.warnings,
        subscriptions: entry.compiled.subscriptions.length,
        activatedAt: entry.activatedAt,
      },
    });
  } catch (error) {
    if (error instanceof GraphValidationError) {
      broadcastGraphStatus(id, 'error');
      return res.status(400).json({ error: { message: 'Graph is not valid.', details: error.errors, warnings: error.warnings } });
    }
    broadcastGraphStatus(id, 'error');
    throw error;
  }
}

/** POST /api/graphs/:id/deactivate — dispose the pipeline and forget it. */
export async function deactivateGraphHandler(req, res) {
  const { id } = res.locals.validated.params;
  const deactivated = activeGraphManager.deactivate(id);
  if (!deactivated) throw httpError(404, 'No active pipeline found for this graph.');
  return res.json({ data: { graphId: id, active: false } });
}

/** GET /api/graphs/active — summaries of every running pipeline. */
export async function listActiveGraphs(req, res) {
  res.json({ data: activeGraphManager.list() });
}

/**
 * POST /api/graphs/:id/test — dry run: push sample values through the compiled pipeline
 * and return the alerts that fired. Nothing is sent and nothing is persisted.
 */
export async function testGraphHandler(req, res) {
  const { id } = res.locals.validated.params;
  const { values } = res.locals.validated.body;

  const graph = await Graph.findById(id).lean();
  if (!graph) throw httpError(404, 'Graph not found.');

  let compiled;
  try {
    compiled = compileGraph({ nodes: graph.nodes ?? [], edges: graph.edges ?? [] }, { graphId: String(graph._id), dryRun: true });
  } catch (error) {
    if (error instanceof GraphValidationError) {
      return res.status(400).json({ error: { message: 'Graph is not valid.', details: error.errors, warnings: error.warnings } });
    }
    throw error;
  }

  try {
    const delivered = compiled.pushValues(values);
    // Handlers are async; let the microtask queue drain before reading the results.
    await new Promise((resolve) => setImmediate(resolve));
    const alerts = compiled.getAlerts();
    res.json({
      data: {
        graphId: String(graph._id),
        dryRun: true,
        values: values.length,
        delivered,
        alertCount: alerts.length,
        alerts,
      },
    });
  } finally {
    compiled.dispose();
  }
}
