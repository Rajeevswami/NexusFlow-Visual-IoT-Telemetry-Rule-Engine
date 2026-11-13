/**
 * Per-canvas external store. Messages update Maps and notify ONLY the affected
 * edge/node subscribers; no React state lives in the canvas parent. Badges retain
 * their latest value after the 600 ms pulse expires.
 */
export const GLOW_MS = 600;
export class CanvasActivityStore {
  constructor() {
    this.graphId = null; this.enabled = true; this.topologyKey = '';
    this.incoming = new Map(); this.nodeTypes = new Map(); this.parents = new Map();
    this.edges = new Map(); this.values = new Map();
    this.edgeListeners = new Map(); this.nodeListeners = new Map(); this.timer = null;
  }
  configure(graphId, nodes, edges) {
    const key = `${graphId}|${edges.map((e) => `${e.id}:${e.source}>${e.target}`).join(',')}|${nodes.map((n) => `${n.id}:${n.type}`).join(',')}`;
    if (key === this.topologyKey) return;
    this.topologyKey = key; this.graphId = graphId;
    this.incoming = new Map(); this.nodeTypes = new Map(); this.parents = new Map();
    for (const node of nodes) { this.nodeTypes.set(node.id, node.type); this.incoming.set(node.id, []); this.parents.set(node.id, []); }
    for (const edge of edges) { this.incoming.get(edge.target)?.push(edge.id); this.parents.get(edge.target)?.push(edge.source); }
    const edgeIds = [...this.edges.keys()]; const nodeIds = [...this.values.keys()];
    this.edges.clear(); this.values.clear();
    edgeIds.forEach((id) => this.#notify(this.edgeListeners, id)); nodeIds.forEach((id) => this.#notify(this.nodeListeners, id));
  }
  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      for (const id of this.edges.keys()) this.edges.delete(id), this.#notify(this.edgeListeners, id);
      for (const [id, value] of this.values) this.values.set(id, { ...value, active: false }), this.#notify(this.nodeListeners, id);
    }
  }
  #notify(listeners, id) { for (const listener of listeners.get(id) ?? []) listener(); }
  #schedule() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const now = Date.now(); let active = false;
      for (const [id, entry] of this.edges) {
        if (entry.expiresAt <= now) { this.edges.delete(id); this.#notify(this.edgeListeners, id); } else active = true;
      }
      for (const [id, entry] of this.values) {
        if (entry.active && entry.expiresAt <= now) { this.values.set(id, { ...entry, active: false }); this.#notify(this.nodeListeners, id); }
        else if (entry.active) active = true;
      }
      if (!active) { clearInterval(this.timer); this.timer = null; }
    }, 80);
  }
  #edge(id, tone = 'data') {
    const existing = this.edges.get(id);
    // Normal traffic must not immediately erase an alert pulse on a busy path.
    if (tone !== 'alert' && existing?.tone === 'alert' && existing.expiresAt > Date.now()) return;
    this.edges.set(id, { tone, expiresAt: Date.now() + GLOW_MS });
    this.#notify(this.edgeListeners, id);
  }
  #node(id, data = {}, tone = 'data') {
    const type = this.nodeTypes.get(id);
    this.values.set(id, { value: data.value, label: data.label ?? (type === 'movingAverage' ? 'avg' : 'value'), unit: data.unit ?? '',
      tone: tone === 'alert' || type === 'threshold' || ['smsAlert', 'webhook', 'email'].includes(type) ? 'alert' : tone,
      active: true, expiresAt: Date.now() + GLOW_MS });
    this.#notify(this.nodeListeners, id);
  }
  ingest = (message) => {
    if (!this.enabled || message?.data?.graphId !== this.graphId) return;
    const data = message.data;
    if (message.type === 'node_activity' && this.nodeTypes.has(data.nodeId)) {
      this.#node(data.nodeId, data, data.tone);
      for (const id of this.incoming.get(data.nodeId) ?? []) this.#edge(id, data.tone);
      this.#schedule();
    } else if (message.type === 'edge_activity') {
      this.#edge(data.edgeId, data.tone); this.#schedule();
    } else if (message.type === 'alert' && data.nodeId) {
      // Mark the actual upstream alert path red, not every wire in the graph.
      const visited = new Set(); const queue = [data.nodeId];
      while (queue.length && visited.size < 500) {
        const id = queue.shift(); if (visited.has(id)) continue; visited.add(id);
        this.#node(id, { value: data.value }, 'alert');
        for (const edgeId of this.incoming.get(id) ?? []) this.#edge(edgeId, 'alert');
        queue.push(...(this.parents.get(id) ?? []));
      }
      this.#schedule();
    }
  };
  subscribeEdge = (id, listener) => this.#subscribe(this.edgeListeners, id, listener);
  subscribeNode = (id, listener) => this.#subscribe(this.nodeListeners, id, listener);
  #subscribe(map, id, listener) {
    if (!map.has(id)) map.set(id, new Set());
    map.get(id).add(listener);
    return () => { map.get(id)?.delete(listener); if (map.get(id)?.size === 0) map.delete(id); };
  }
  getEdge = (id) => this.edges.get(id) ?? null;
  getNode = (id) => this.values.get(id) ?? null;
  dispose() { clearInterval(this.timer); this.timer = null; this.edges.clear(); this.values.clear(); }
}
