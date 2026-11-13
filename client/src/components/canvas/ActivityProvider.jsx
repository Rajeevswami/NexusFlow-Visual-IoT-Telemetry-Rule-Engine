import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { CanvasActivityStore } from '../../services/activityStore.js';
import { useChannel } from '../../ws/useChannel.js';

const ActivityContext = createContext(null);
export function ActivityProvider({ graphId, nodes, edges, liveMode = true, children }) {
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = new CanvasActivityStore();
  const store = storeRef.current;
  const topology = useMemo(() => ({
    nodes: nodes.map(({ id, type }) => ({ id, type })),
    edges: edges.map(({ id, source, target }) => ({ id, source, target })),
  }), [nodes, edges]);
  useEffect(() => { store.configure(graphId, topology.nodes, topology.edges); }, [store, graphId, topology]);
  useEffect(() => { store.setEnabled(liveMode); }, [store, liveMode]);
  useEffect(() => () => store.dispose(), [store]);
  useChannel(graphId ? `graph:${graphId}` : null, store.ingest);
  return <ActivityContext.Provider value={store}>{children}</ActivityContext.Provider>;
}
export function useCanvasActivity() { return useContext(ActivityContext); }
const noopUnsubscribe = () => {};
const emptySnapshot = () => null;
export function useEdgeActivity(id) {
  const store = useCanvasActivity();
  const subscribe = useCallback((listener) => store ? store.subscribeEdge(id, listener) : noopUnsubscribe(), [store, id]);
  const snapshot = useCallback(() => store ? store.getEdge(id) : null, [store, id]);
  return useSyncExternalStore(store ? subscribe : noopUnsubscribe, snapshot, emptySnapshot);
}
export function useNodeActivity(id) {
  const store = useCanvasActivity();
  const subscribe = useCallback((listener) => store ? store.subscribeNode(id, listener) : noopUnsubscribe(), [store, id]);
  const snapshot = useCallback(() => store ? store.getNode(id) : null, [store, id]);
  return useSyncExternalStore(store ? subscribe : noopUnsubscribe, snapshot, emptySnapshot);
}
