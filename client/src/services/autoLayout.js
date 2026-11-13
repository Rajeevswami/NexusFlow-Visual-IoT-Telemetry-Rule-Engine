/** Dagre is loaded only when the user asks for layout. */
export async function layoutGraph(nodes, edges) {
  const { default: dagre } = await import('@dagrejs/dagre');
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 90, marginx: 40, marginy: 60 });
  const sizes = new Map();
  for (const node of nodes) {
    const size = { width: 280, height: node.type === 'webhook' ? 540 : node.type === 'email' ? 400 : node.type === 'smsAlert' ? 330 : 220 };
    sizes.set(node.id, size); graph.setNode(node.id, size);
  }
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);
  return nodes.map((node) => { const point = graph.node(node.id); const size = sizes.get(node.id); return { ...node, position: { x: point.x - size.width / 2, y: point.y - size.height / 2 } }; });
}
