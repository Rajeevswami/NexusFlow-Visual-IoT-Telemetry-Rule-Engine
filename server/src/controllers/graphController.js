import { Graph } from '../models/Graph.js';

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
