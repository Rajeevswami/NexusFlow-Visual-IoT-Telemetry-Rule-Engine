import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasActivityStore } from '../src/services/activityStore.js';

test('activity is scoped, targets listeners, preserves alert pulses and can be disabled', () => {
  const store = new CanvasActivityStore();
  store.configure('graph-1', [{ id: 'a', type: 'sensor' }, { id: 'b', type: 'threshold' }], [{ id: 'edge-1', source: 'a', target: 'b' }]);
  let edgeNotifications = 0;
  const unsubscribe = store.subscribeEdge('edge-1', () => { edgeNotifications += 1; });
  store.ingest({ type: 'edge_activity', data: { graphId: 'other', edgeId: 'edge-1' } });
  assert.equal(edgeNotifications, 0);
  store.ingest({ type: 'node_activity', data: { graphId: 'graph-1', nodeId: 'b', value: 82 } });
  assert.equal(store.getNode('b').value, 82);
  assert.equal(edgeNotifications, 1);
  store.ingest({ type: 'alert', data: { graphId: 'graph-1', nodeId: 'b', value: 82 } });
  assert.equal(store.getEdge('edge-1').tone, 'alert');
  store.ingest({ type: 'edge_activity', data: { graphId: 'graph-1', edgeId: 'edge-1' } });
  assert.equal(store.getEdge('edge-1').tone, 'alert');
  store.setEnabled(false);
  assert.equal(store.getEdge('edge-1'), null);
  assert.equal(store.getNode('b').active, false);
  unsubscribe();
  store.dispose();
});
