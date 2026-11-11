/**
 * Graph serialization.
 *
 * The editor keeps a lot of runtime state on nodes and edges (measurements, selection,
 * dragging, styling). Only the fields the compiler needs are persisted, which keeps the
 * saved JSON clean and stable:
 *
 *   { name, nodes: [{ id, type, data, position }], edges: [{ id, source, target }], viewport }
 */

/** Keep only the persisted fields of a React Flow node. */
export function serializeNode(node) {
  return {
    id: node.id,
    type: node.type,
    position: { x: Number(node.position?.x ?? 0), y: Number(node.position?.y ?? 0) },
    data: {
      kind: node.data?.kind ?? node.type,
      label: node.data?.label,
      category: node.data?.category,
      description: node.data?.description,
      config: { ...(node.data?.config ?? {}) },
    },
  };
}

/** Keep only the persisted fields of a React Flow edge. */
export function serializeEdge(edge) {
  return { id: edge.id, source: edge.source, target: edge.target };
}

/**
 * Build the clean JSON that is sent to `POST /api/graphs`.
 *
 * @param {string} name graph name
 * @param {any[]} nodes React Flow nodes
 * @param {any[]} edges React Flow edges
 * @param {{x: number, y: number, zoom: number}} [viewport]
 */
export function serializeGraph(name, nodes, edges, viewport) {
  const payload = {
    name: (name ?? '').trim() || 'Untitled graph',
    nodes: nodes.map(serializeNode),
    edges: edges.map(serializeEdge),
  };
  if (viewport && Number.isFinite(viewport.zoom)) {
    payload.viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
  }
  return payload;
}

/** Pretty-printed JSON, ready to download or copy. */
export const toJsonString = (graph) => JSON.stringify(graph, null, 2);

/** Trigger a browser download for the graph JSON. */
export function downloadJson(graph, filename) {
  const blob = new Blob([toJsonString(graph)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Filesystem-safe filename derived from the graph name. */
export function graphFilename(name, extension = 'json') {
  const slug = (name ?? 'graph')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'nexusflow-graph'}.${extension}`;
}

/** Copy text to the clipboard, falling back to a hidden textarea on insecure origins. */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
