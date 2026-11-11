import { Graph } from '../models/Graph.js';
import { compileGraph } from '../compiler/index.js';
import { httpError } from '../utils/httpError.js';
import { broadcastAlert } from './websocket.js';

/**
 * Holds the compiled pipelines that are currently running, keyed by graph id.
 *
 * Compiling is cheap but not free: a graph is compiled once on activation and then fed
 * by the ingestion path. Re-compiling or deactivating always disposes the previous
 * pipeline so no subscription or Subject is left behind.
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
        onAlert: (alert) => broadcastAlert({ graphId: id, ...alert }),
      },
    );

    // Replace any previously compiled version of this graph.
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
    return entry;
  }

  /**
   * Dispose a running pipeline.
   * @param {string} graphId
   * @returns {boolean} true when something was deactivated
   */
  deactivate(graphId) {
    const entry = this.#pipelines.get(graphId);
    if (!entry) return false;
    try {
      entry.compiled.dispose();
    } catch (error) {
      console.error(`Failed to dispose pipeline ${graphId}: ${error.message}`);
    }
    this.#pipelines.delete(graphId);
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
   * Feed freshly ingested readings into every active pipeline.
   * Never throws: a broken pipeline must not fail ingestion.
   *
   * @param {object[]} readings persisted telemetry documents
   * @returns {number} how many (pipeline, reading) deliveries happened
   */
  publish(readings) {
    if (this.#pipelines.size === 0 || !Array.isArray(readings) || readings.length === 0) return 0;
    let delivered = 0;
    for (const entry of this.#pipelines.values()) {
      for (const reading of readings) {
        try {
          delivered += entry.compiled.publish(reading);
        } catch (error) {
          console.error(`Pipeline ${entry.graphId} failed to process a reading: ${error.message}`);
        }
      }
    }
    return delivered;
  }

  /** Dispose everything — used on shutdown and by tests. */
  disposeAll() {
    for (const graphId of [...this.#pipelines.keys()]) this.deactivate(graphId);
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
