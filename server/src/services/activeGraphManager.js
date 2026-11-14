import logger from '../config/logger.js';
import { Graph } from '../models/Graph.js';
import { compileGraph } from '../compiler/index.js';
import { httpError } from '../utils/httpError.js';
import { env } from '../config/env.js';
import { broadcastAlert, broadcastEdgeActivity, broadcastGraphStatus, broadcastNodeActivity } from './websocket.js';
import { ruleExecutor } from './ruleExecutor.js';
import { telemetryBus } from './telemetryBus.js';

/**
 * Holds the compiled pipelines that are currently running, keyed by graph id.
 *
 * Compiling is cheap but not free: a graph is compiled once on activation and then fed
 * by the ingestion path. Re-compiling or deactivating always disposes the previous
 * pipeline so no subscription or Subject is left behind.
 *
 * `isActive` on the Graph document is kept in sync with this map so a restart can
 * re-hydrate every graph that was running (see `hydrateActiveGraphs`).
 */
class ActiveGraphManager {
  /** @type {Map<string, { graphId: string, name: string, compiled: object, activatedAt: Date, sources: object[] }>} */
  #pipelines = new Map();

  /**
   * Load a saved graph, validate + compile it and make it the active pipeline.
   *
   * @param {string} graphId
   * @returns {Promise<object>} activation summary
   */
  async activate(graphId) {
    const graph = await Graph.findById(graphId).lean();
    if (!graph) throw httpError(404, 'Graph not found.');

    const id = String(graph._id);
    const compiled = compileGraph(
      { nodes: graph.nodes ?? [], edges: graph.edges ?? [] },
      {
        graphId: id,
        onAlert: (alert) => {
          telemetryBus.recordAlertFired();
          broadcastAlert({ graphId: id, ...alert });
        },
        // Optional per-node activity taps (Day 4 glowing wires); off by default in
        // production unless NODE_ACTIVITY_ENABLED=true.
        trackActivity: env.nodeActivityEnabled,
        onActivity: (activity) => broadcastNodeActivity(activity),
        onEdgeActivity: (activity) => broadcastEdgeActivity(activity),
      },
    );

    // Replace any previously compiled version of this graph. Compilation happens
    // first so an invalid graph never takes the running pipeline down with it.
    this.deactivate(id);
    const entry = {
      graphId: id,
      name: graph.name,
      compiled,
      sources: compiled.sources,
      nodeCount: compiled.nodeCount,
      edgeCount: compiled.edgeCount,
      warnings: compiled.warnings,
      activatedAt: new Date(),
    };
    this.#pipelines.set(id, entry);
    // Route live telemetry to this graph through the rule executor (O(1) key lookup).
    ruleExecutor.register({ graphId: id, sources: compiled.sources, publish: compiled.publish });
    // Best-effort flag: the pipeline is live even if the write fails.
    void Graph.updateOne({ _id: id }, { $set: { isActive: true } }).catch((error) => {
      logger.warn({ err: error, graphId: id }, 'Could not flag the graph as active');
    });
    broadcastGraphStatus(id, 'active');
    return entry;
  }

  /**
   * Dispose a running pipeline and record that the operator no longer wants it.
   *
   * This is the user-facing path (the API, the demo controller): the `isActive` flag is
   * cleared so a restart does not resurrect a graph that was switched off on purpose.
   *
   * @param {string} graphId
   * @returns {boolean} true when something was deactivated
   */
  deactivate(graphId) {
    const entry = this.#pipelines.get(graphId);
    if (!entry) return false;
    this.#dispose(entry);
    this.#pipelines.delete(graphId);
    // Stop routing live telemetry to this graph and tell subscribers it is gone.
    try { ruleExecutor.unregister(graphId); } catch (error) { logger.error({ err: error }, `Failed to unregister ${graphId}`); }
    void Graph.updateOne({ _id: graphId }, { $set: { isActive: false } }).catch((error) => {
      logger.warn({ err: error, graphId }, 'Could not clear the active flag');
    });
    broadcastGraphStatus(graphId, 'inactive');
    return true;
  }

  /** @returns {object[]} summaries of every active pipeline */
  list() {
    return [...this.#pipelines.values()].map((entry) => this.#summarise(entry));
  }

  /** @param {string} graphId */
  get(graphId) {
    const entry = this.#pipelines.get(graphId);
    return entry ? this.#summarise(entry) : null;
  }

  /**
   * Dispose every pipeline without touching the database.
   *
   * Used by the shutdown path and by tests. The `isActive` flag deliberately survives:
   * it records the operator's intent ("this graph should be running"), not this
   * process's transient state, so a restart re-hydrates it. Only an explicit
   * `deactivate()` clears the flag.
   */
  disposeAll() {
    for (const entry of [...this.#pipelines.values()]) this.#dispose(entry);
    this.#pipelines.clear();
  }

  /** In-memory teardown of one pipeline: unsubscribe and complete its Subjects. */
  #dispose(entry) {
    try {
      entry.compiled.dispose();
    } catch (error) {
      logger.error({ err: error }, `Failed to dispose pipeline ${entry.graphId}`);
    }
    try { ruleExecutor.unregister(entry.graphId); } catch (error) { logger.error({ err: error }, `Failed to unregister ${entry.graphId}`); }
  }

  /**
   * Boot-time re-hydration: recompile every graph flagged `isActive` so a restart
   * (deploy, crash, free-tier sleep) does not silently stop the rules.
   *
   * The flag records the operator's intent, so a graceful shutdown deliberately does
   * NOT clear it (see `disposeAll`). A graph that can no longer compile - edited into
   * an invalid state while the server was down - is flagged inactive again so it does
   * not fail on every boot. Each graph is independent: one failure never blocks the rest.
   *
   * @returns {Promise<{ total: number, activated: number, failed: number }>}
   */
  async hydrateActiveGraphs() {
    let total = 0;
    let activated = 0;
    let failed = 0;
    let candidates;
    try {
      candidates = await Graph.find({ isActive: true }).select('_id name').lean();
    } catch (error) {
      logger.error({ err: error }, 'Could not load active graphs for re-hydration');
      return { total: 0, activated: 0, failed: 0 };
    }
    total = candidates.length;
    for (const candidate of candidates) {
      const id = String(candidate._id);
      try {
        await this.activate(id);
        activated += 1;
        logger.info({ graphId: id, name: candidate.name }, 'Re-hydrated active graph');
      } catch (error) {
        failed += 1;
        // A graph that can no longer compile must not keep claiming to be active.
        await Graph.updateOne({ _id: id }, { $set: { isActive: false } }).catch(() => {});
        logger.error({ err: error, graphId: id }, 'Re-hydration failed for an active graph');
      }
    }
    return { total, activated, failed };
  }

  #summarise(entry) {
    return {
      graphId: entry.graphId,
      name: entry.name,
      nodeCount: entry.nodeCount,
      edgeCount: entry.edgeCount,
      sources: entry.sources,
      warnings: entry.warnings,
      activatedAt: entry.activatedAt,
      subscriptions: entry.compiled.subscriptions.length,
    };
  }
}

export const activeGraphManager = new ActiveGraphManager();
export default activeGraphManager;
