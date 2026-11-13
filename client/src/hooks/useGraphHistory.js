import { useCallback, useEffect, useRef, useState } from 'react';
import { serializeEdge, serializeNode } from '../services/graphSerializer.js';

const snapshotOf = (nodes, edges) => ({ nodes: nodes.map(serializeNode), edges: edges.map(serializeEdge) });
const signature = (snapshot) => JSON.stringify(snapshot);
const LIMIT = 50;

/** Debounced structural history: selection/dimensions don't create entries; drags/config edits do. */
export function useGraphHistory(nodes, edges, setNodes, setEdges) {
  const current = useRef(snapshotOf(nodes, edges));
  current.current = snapshotOf(nodes, edges);
  const history = useRef({ past: [], present: current.current, future: [] });
  const timer = useRef(null);
  const applying = useRef(null);
  const [, refresh] = useState(0);
  const bump = () => refresh((value) => value + 1);
  const commit = useCallback(() => {
    const next = current.current; const h = history.current;
    if (signature(next) === signature(h.present)) return;
    h.past.push(h.present); if (h.past.length > LIMIT) h.past.shift();
    h.present = next; h.future = []; bump();
  }, []);
  useEffect(() => {
    const key = signature(current.current);
    if (applying.current === key) { applying.current = null; return undefined; }
    if (key === signature(history.current.present)) return undefined;
    clearTimeout(timer.current); timer.current = setTimeout(commit, 250);
    return () => clearTimeout(timer.current);
  }, [nodes, edges, commit]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const apply = useCallback((snapshot) => {
    applying.current = signature(snapshot);
    setNodes(snapshot.nodes.map((node) => ({ ...node, selected: false })));
    setEdges(snapshot.edges.map((edge) => ({ ...edge, type: 'glowEdge', selected: false })));
    bump();
  }, [setNodes, setEdges]);
  const undo = useCallback(() => {
    clearTimeout(timer.current); commit(); const h = history.current;
    if (!h.past.length) return;
    h.future.push(h.present); h.present = h.past.pop(); apply(h.present);
  }, [commit, apply]);
  const redo = useCallback(() => {
    clearTimeout(timer.current); commit(); const h = history.current;
    if (!h.future.length) return;
    h.past.push(h.present); h.present = h.future.pop(); apply(h.present);
  }, [commit, apply]);
  const reset = useCallback((nextNodes, nextEdges) => {
    clearTimeout(timer.current); const snapshot = snapshotOf(nextNodes, nextEdges);
    history.current = { past: [], present: snapshot, future: [] }; applying.current = signature(snapshot); bump();
  }, []);
  return { undo, redo, reset, canUndo: history.current.past.length > 0 || signature(current.current) !== signature(history.current.present), canRedo: history.current.future.length > 0 };
}
