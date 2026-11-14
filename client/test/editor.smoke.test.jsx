import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import FlowCanvas from '../src/components/canvas/FlowCanvas.jsx';
import { serializeGraph, serializeNode, serializeEdge, toJsonString } from '../src/services/graphSerializer.js';
import { initialNodes, initialEdges, makeNode, NODE_TYPES } from '../src/components/nodes/definitions.js';

/**
 * Frontend smoke tests: the canvas renders, a node can be dropped onto it, and the
 * resulting graph serializes to the JSON the compiler expects.
 *
 * These are deliberately behavioural rather than pixel-perfect: they are the guard
 * against a refactor that silently breaks authoring or the save payload.
 */

/** A drop/dragover event carrying a dataTransfer that behaves like the real one. */
function dragEvent(type, files = []) {
  const store = new Map(files);
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      getData: (key) => store.get(key) ?? '',
      setData: (key, value) => store.set(key, value),
      dropEffect: 'move',
      effectAllowed: 'all',
      types: [...store.keys()],
      items: [],
      files: [],
    },
  });
  Object.defineProperty(event, 'clientX', { value: 240 });
  Object.defineProperty(event, 'clientY', { value: 180 });
  return event;
}

describe('canvas smoke tests', () => {
  beforeEach(() => {
    // The editor talks to the API and to a WebSocket on mount; neither exists in jsdom.
    vi.stubGlobal('WebSocket', class {
      constructor() { this.readyState = 0; }
      send() {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the canvas with the default nodes and connections', async () => {
    render(
      <ReactFlowProvider>
        <FlowCanvas
          nodes={initialNodes}
          edges={initialEdges}
          onNodesChange={() => {}}
          onEdgesChange={() => {}}
          onConnect={() => {}}
          onDrop={() => {}}
        />
      </ReactFlowProvider>,
    );

    // React Flow renders one DOM element per node.
    await waitFor(() => expect(document.querySelectorAll('.react-flow__node')).toHaveLength(initialNodes.length));
    expect(document.querySelector('.react-flow')).toBeTruthy();
    expect(document.querySelector('.react-flow__edges')).toBeTruthy();
    expect(screen.getByText('YOUR WORKSPACE')).toBeTruthy();

    // Every node shows its label, so the node registry and the canvas agree.
    for (const node of initialNodes) {
      expect(screen.getByText(node.data.label)).toBeTruthy();
    }
  });

  it('accepts a dropped node and reports it to the editor', async () => {
    const onDrop = vi.fn();
    const { container } = render(
      <ReactFlowProvider>
        <FlowCanvas
          nodes={initialNodes}
          edges={initialEdges}
          onNodesChange={() => {}}
          onEdgesChange={() => {}}
          onConnect={() => {}}
          onDrop={onDrop}
        />
      </ReactFlowProvider>,
    );
    await waitFor(() => expect(container.querySelector('.canvas-wrap')).toBeTruthy());

    const wrap = container.querySelector('.canvas-wrap');
    const dragged = JSON.stringify({ type: 'smsAlert', config: { phone: '+911234567890' } });
    await act(async () => {
      wrap.dispatchEvent(dragEvent('dragover'));
      wrap.dispatchEvent(dragEvent('drop', [['application/nexusflow-node', dragged]]));
    });

    expect(onDrop).toHaveBeenCalledTimes(1);
    const event = onDrop.mock.calls[0][0];
    expect(JSON.parse(event.dataTransfer.getData('application/nexusflow-node')))
      .toEqual({ type: 'smsAlert', config: { phone: '+911234567890' } });
  });

  it('a node dropped onto the canvas ends up in the serialized graph JSON', async () => {
    // The editor's own drop handler is what turns the payload into a node; here we
    // exercise makeNode + serializeGraph, which is the same path saveGraph() uses.
    const dropped = makeNode('smsAlert', { x: 480, y: 120 }, undefined, { phone: '+911234567890', messageTemplate: 'ALERT {{deviceId}}' });
    const nodes = [...initialNodes, dropped];
    const edges = [...initialEdges, { id: 'edge-dropped', source: 'threshold-1', target: dropped.id }];

    expect(dropped.type).toBe('smsAlert');
    expect(dropped.data.config.phone).toBe('+911234567890');

    const payload = serializeGraph('Smoke test graph', nodes, edges);
    const roundTripped = JSON.parse(toJsonString(payload));

    expect(roundTripped.name).toBe('Smoke test graph');
    expect(roundTripped.nodes).toHaveLength(initialNodes.length + 1);
    expect(roundTripped.edges).toHaveLength(initialEdges.length + 1);
    // Exactly the fields the compiler needs survive: id, type, position, data.config.
    const serialized = roundTripped.nodes.at(-1);
    expect(serialized.id).toBe(dropped.id);
    expect(serialized.type).toBe('smsAlert');
    expect(serialized.position).toEqual({ x: 480, y: 120 });
    expect(serialized.data.kind).toBe('smsAlert');
    expect(serialized.data.category).toBe('action');
    expect(typeof serialized.data.label).toBe('string');
    expect(serialized.data.config).toEqual({
      ...NODE_TYPES.smsAlert.defaultConfig,
      phone: '+911234567890',
      messageTemplate: 'ALERT {{deviceId}}',
    });
    // No React Flow runtime state leaks into the payload.
    expect(JSON.stringify(roundTripped)).not.toContain('selected');
    expect(JSON.stringify(roundTripped)).not.toContain('measured');
    // Edge endpoints reference real nodes, which the server validator requires.
    const ids = new Set(roundTripped.nodes.map((node) => node.id));
    for (const edge of roundTripped.edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
    expect(serializeNode(dropped)).toEqual(roundTripped.nodes.at(-1));
    expect(serializeEdge(edges.at(-1))).toEqual({ id: 'edge-dropped', source: 'threshold-1', target: dropped.id });
  });

  it('buffers live telemetry instead of re-rendering per WebSocket message', async () => {
    // A controllable socket: the test pushes server frames straight into onmessage.
    const sockets = [];
    vi.stubGlobal('WebSocket', class {
      constructor() {
        this.readyState = 0;
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;
        sockets.push(this);
      }
      send(message) { this.sent = this.sent ?? []; this.sent.push(JSON.parse(message)); }
      close() { this.readyState = 3; }
    });

    const { useTelemetrySeries } = await import('../src/hooks/useTelemetrySeries.js');
    const { WebSocketProvider } = await import('../src/ws/WebSocketProvider.jsx');

    let renders = 0;
    function Probe() {
      const { points, pointCount } = useTelemetrySeries('telemetry:turbine-001', { flushMs: 200, maxPoints: 60 });
      renders += 1;
      return <span data-testid="points">{pointCount}</span>;
    }

    render(<WebSocketProvider><Probe /></WebSocketProvider>);
    await waitFor(() => expect(sockets.length).toBe(1));
    await act(async () => { sockets[0].onopen(); });

    const deliver = async (values) => {
      await act(async () => {
        for (const value of values) {
          sockets[0].onmessage({ data: JSON.stringify({ type: 'telemetry', data: { metadata: { deviceId: 'turbine-001', sensorType: 'temperature' }, value, unit: '\u00b0C', timestamp: new Date().toISOString() } }) });
        }
      });
    };

    await deliver([10, 11, 12, 13, 14, 15]);
    // The buffer is flushed on a timer, not per message: six messages must not have
    // produced six state updates.
    const afterBurst = renders;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });

    expect(screen.getByTestId('points').textContent).toBe('6');
    expect(renders - afterBurst).toBeLessThan(3);
    // Subscriptions are replayed to the server after a reconnect.
    await act(async () => { sockets[0].onclose(); });
    await waitFor(() => expect(sockets.length).toBeGreaterThan(1));
  });
});
