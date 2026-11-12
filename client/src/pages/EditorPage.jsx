import { useCallback, useEffect, useRef, useState } from 'react';
import { addEdge, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react';
import { AlertTriangle, CheckCircle2, ChevronRight, CircleHelp, PencilLine, X } from 'lucide-react';
import FlowCanvas from '../components/canvas/FlowCanvas.jsx';
import NodePalette from '../components/canvas/NodePalette.jsx';
import { validateGraph } from '../components/canvas/graphRules.js';
import { getDefinition, initialEdges, initialNodes, makeNode } from '../components/nodes/definitions.js';
import FlowInspector from '../components/FlowInspector.jsx';
import GraphPicker from '../components/GraphPicker.jsx';
import Navbar from '../components/layout/Navbar.jsx';
import ValidationPanel from '../components/ValidationPanel.jsx';
import { errorMessage, graphApi, telemetryApi } from '../services/api.js';
import { copyText, downloadJson, graphFilename, serializeGraph, toJsonString } from '../services/graphSerializer.js';
import { useTelemetry } from '../services/useTelemetry.js';
import { useChannel } from '../ws/useChannel.js';

/** Dimensions of a node card, used to centre a dropped node under the cursor. */
const NODE_OFFSET = { x: 130, y: 46 };

export default function EditorPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [name, setName] = useState('Turbine overheat rule');
  const [health, setHealth] = useState('checking');
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [graphs, setGraphs] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [loadingId, setLoadingId] = useState('');
  const [notice, setNotice] = useState(null);
  // ---------------------------------------------------------- live activation
  const [graphId, setGraphId] = useState('');
  const [activation, setActivation] = useState({ status: 'inactive', message: '' });
  const [activating, setActivating] = useState(false);
  const [testing, setTesting] = useState(false);
  const canvasRef = useRef(null);
  const nameRef = useRef(null);
  const exportRef = useRef('');
  const flow = useReactFlow();
  const { socketStatus, readings } = useTelemetry();
  const selectedNode = nodes.find((node) => node.selected);

  // Live pipeline status pushed by the server (`graph_status` on activate/deactivate/error).
  useChannel(graphId ? `graph:${graphId}` : null, useCallback((message) => {
    if (message.type !== 'graph_status' || !message.data) return;
    const { status } = message.data;
    setActivation((current) => {
      if (status === 'active') return { status: 'active', message: 'Pipeline is evaluating live telemetry.' };
      if (status === 'error') return { status: 'error', message: 'Activation failed.' };
      if (current.status !== 'inactive') return { status: 'inactive', message: 'Pipeline deactivated.' };
      return current;
    });
  }, []));

  // ------------------------------------------------------------- backend health
  useEffect(() => {
    let mounted = true;
    async function check() {
      try { await graphApi.health(); if (mounted) setHealth('online'); }
      catch { if (mounted) setHealth('offline'); }
    }
    check();
    const timer = setInterval(check, 15_000);
    window.addEventListener('focus', check);
    return () => { mounted = false; clearInterval(timer); window.removeEventListener('focus', check); };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), notice.action ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // ------------------------------------------------------------------ graph ops
  const onConnect = useCallback((connection) => {
    setEdges((current) => addEdge({ ...connection, type: 'smoothstep' }, current));
  }, [setEdges]);

  function addNode(type, position, config) {
    if (!getDefinition(type)) return;
    setNodes((current) => [...current, makeNode(type, position, undefined, config)]);
  }

  /**
   * Palette drag payload: a JSON string `{ type, config }`.
   * A bare type string is still accepted (graphs dragged before Day 2 used that format).
   */
  function parseDragPayload(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.type) return { type: parsed.type, config: parsed.config };
    } catch {
      // Not JSON: treat the payload as a plain node type.
    }
    return { type: raw, config: undefined };
  }

  function handleDrop(event) {
    event.preventDefault();
    const { type, config } = parseDragPayload(event.dataTransfer.getData('application/nexusflow-node')) ?? {};
    if (!type || !getDefinition(type)) return;
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addNode(type, { x: position.x - NODE_OFFSET.x, y: position.y - NODE_OFFSET.y }, config);
  }

  function handlePaletteClick(type, config) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const position = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    addNode(type, { x: position.x - NODE_OFFSET.x, y: position.y - NODE_OFFSET.y }, config);
  }

  function removeNode(id) {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
  }

  function focusNode(nodeId) {
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })));
    flow.fitView({ nodes: [{ id: nodeId }], duration: 400, maxZoom: 1.2, padding: 0.6 });
  }

  // ---------------------------------------------------------------- save / load
  async function saveGraph() {
    if (!name.trim()) {
      setNotice({ type: 'error', message: 'Give your graph a name before saving.' });
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const { viewport } = flow.toObject();
      const payload = serializeGraph(name, nodes, edges, viewport);
      const created = await graphApi.create(payload);
      setGraphId(created.data.data._id);
      setActivation({ status: 'inactive', message: '' });
      setName(payload.name);
      setNotice({ type: 'success', message: `Graph saved with ${payload.nodes.length} nodes and ${payload.edges.length} edges. Ready to Activate.` });
    } catch (error) {
      setNotice({ type: 'error', message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  async function fetchGraphs() {
    setListLoading(true);
    setListError('');
    try { setGraphs((await graphApi.list()).data.data); }
    catch (error) { setListError(errorMessage(error)); }
    finally { setListLoading(false); }
  }

  const openPicker = () => { setPickerOpen(true); fetchGraphs(); };
  const closePicker = useCallback(() => setPickerOpen(false), []);

  async function loadGraph(id) {
    setLoadingId(id);
    try {
      const graph = (await graphApi.get(id)).data.data;
      setNodes(graph.nodes ?? []);
      // Saved edges carry no `type`; re-apply the canvas default so the round trip is seamless.
      setEdges((graph.edges ?? []).map((edge) => ({ type: 'smoothstep', ...edge })));
      setName(graph.name ?? 'Untitled graph');
      setGraphId(id);
      setActivation({ status: 'inactive', message: '' });
      // A loaded graph may already be running — ask the engine so the badge is correct.
      graphApi.active()
        .then((response) => {
          if (response.data.data.some((entry) => entry.graphId === id)) {
            setActivation({ status: 'active', message: 'Pipeline is evaluating live telemetry.' });
          }
        })
        .catch(() => { /* engine status is best-effort */ });
      setValidation(null);
      setPickerOpen(false);
      requestAnimationFrame(() => {
        if (graph.viewport) flow.setViewport(graph.viewport, { duration: 300 });
        else flow.fitView({ padding: 0.22, maxZoom: 1, duration: 300 });
      });
      setNotice({ type: 'success', message: 'Graph loaded onto your canvas.' });
    } catch (error) {
      setListError(errorMessage(error));
    } finally {
      setLoadingId('');
    }
  }

  // ------------------------------------------------------------- validate / export
  async function runValidation() {
    setValidating(true);
    const local = validateGraph(nodes, edges);
    setValidation({ result: local, source: 'local' });
    try {
      const response = await graphApi.validate(serializeGraph(name, nodes, edges));
      setValidation({
        result: { errors: response.data.errors, warnings: response.data.warnings },
        source: 'backend',
      });
    } catch (error) {
      // Keep the local verdict; the backend is only reachable when MongoDB is up.
      if (error.response?.status === 400 && Array.isArray(error.response.data?.error?.details)) {
        setValidation({
          result: { errors: error.response.data.error.details, warnings: error.response.data.error.warnings ?? [] },
          source: 'backend',
        });
      }
    } finally {
      setValidating(false);
    }
  }

  function exportJson() {
    const { viewport } = flow.toObject();
    const payload = serializeGraph(name, nodes, edges, viewport);
    exportRef.current = toJsonString(payload);
    downloadJson(payload, graphFilename(payload.name));
    setNotice({
      type: 'success',
      message: `Exported ${payload.nodes.length} nodes and ${payload.edges.length} edges as JSON.`,
      action: {
        label: 'Copy JSON',
        onClick: async () => {
          const copied = await copyText(exportRef.current);
          setNotice({ type: copied ? 'success' : 'error', message: copied ? 'Graph JSON copied to your clipboard.' : 'Could not access the clipboard.' });
        },
      },
    });
  }

  const showInvalidConnection = useCallback((reason) => {
    setNotice({ type: 'error', message: reason ?? 'That connection is not allowed.' });
  }, []);

  // ------------------------------------------------------- activate / deactivate
  async function activateGraph() {
    if (!graphId) {
      setNotice({ type: 'error', message: 'Save the graph first — activation runs the saved version.' });
      return;
    }
    setActivating(true);
    try {
      const response = await graphApi.compile(graphId);
      const data = response.data.data;
      setActivation({ status: 'active', message: `Evaluating ${data.sources?.length ?? 0} source(s) live.` });
      setNotice({ type: 'success', message: `Pipeline active — ${data.nodeCount} nodes, ${data.subscriptions} subscription(s). Watch the Dashboard.` });
    } catch (error) {
      const details = error.response?.data?.error?.details;
      setActivation({ status: 'error', message: errorMessage(error) });
      setNotice({
        type: 'error',
        message: details?.length ? `Activation failed: ${details[0].message}` : errorMessage(error),
      });
    } finally {
      setActivating(false);
    }
  }

  async function deactivateGraph() {
    if (!graphId) return;
    try {
      await graphApi.deactivate(graphId);
      setActivation({ status: 'inactive', message: 'Pipeline deactivated.' });
      setNotice({ type: 'success', message: 'Pipeline deactivated — rule evaluation stopped.' });
    } catch (error) {
      // 404 means it was not running anyway; treat as inactive.
      if (error.response?.status === 404) setActivation({ status: 'inactive', message: 'Pipeline was not active.' });
      else setNotice({ type: 'error', message: errorMessage(error) });
    }
  }

  /**
   * Push sample readings (a few normal values + overheat spikes) through the real
   * ingestion API so the user sees the rule fire from the UI without the simulator.
   */
  async function sendTestData() {
    const source = nodes.find((node) => node.type === 'sensor' || node.data?.category === 'source');
    const config = source?.data?.config ?? {};
    const deviceId = config.deviceId || 'turbine-001';
    const sensorType = config.sensorType || 'temperature';
    const location = 'Test bench';
    const now = Date.now();
    const values = [50, 52, 48, 96, 51, 97]; // spike above the default threshold (>80)
    const readings = values.map((value, index) => ({
      timestamp: new Date(now - (values.length - index) * 250).toISOString(),
      metadata: { deviceId, sensorType, location },
      value,
      unit: '°C',
    }));

    setTesting(true);
    try {
      const response = await telemetryApi.ingestBatch(readings);
      setNotice({
        type: 'success',
        message: `Sent ${response.data.accepted} readings for ${deviceId} · ${sensorType} (2 overheat spikes). Check the Dashboard${activation.status === 'active' ? ' — the rule should fire' : ' after activating this graph'}.`,
      });
    } catch (error) {
      setNotice({ type: 'error', message: errorMessage(error) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="app-shell">
      <Navbar
        health={health}
        onSave={saveGraph}
        onLoad={openPicker}
        onValidate={runValidation}
        onExport={exportJson}
        saving={saving}
        validating={validating}
        activation={activation}
        onActivate={activateGraph}
        onDeactivate={deactivateGraph}
        onSendTestData={sendTestData}
        activating={activating}
        testing={testing}
      />

      <div className="editor-body">
        <NodePalette onAddNode={handlePaletteClick} />
        <main className="work-area">
          <div className="work-header">
            <div className="work-title">
              <div className="work-breadcrumb"><span>WORKSPACE</span><ChevronRight size={12} /><span>FLOW EDITOR</span></div>
              <div className="name-row">
                <input ref={nameRef} aria-label="Graph name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
                <PencilLine size={15} />
                <span className="draft-badge"><i /> DRAFT</span>
              </div>
              <p>Bring your data and ideas together, one node at a time.</p>
            </div>
            <div className="work-meta">
              <div><strong>{String(nodes.length).padStart(2, '0')}</strong><span>NODES</span></div>
              <i />
              <div><strong>{String(edges.length).padStart(2, '0')}</strong><span>CONNECTIONS</span></div>
            </div>
          </div>

          {validation && (
            <ValidationPanel
              result={validation.result}
              source={validation.source}
              onClose={() => setValidation(null)}
              onSelectNode={focusNode}
            />
          )}

          <FlowCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={handleDrop}
            onInvalidConnection={showInvalidConnection}
            canvasRef={canvasRef}
          />

          <div className="workspace-footer">
            <span><i /> CANVAS MODE <b> / </b> FLOW EDITOR</span>
            <span><CircleHelp size={14} /> Select a node or edge and press Delete to remove it.</span>
            <span>MADE TO FLOW <span className="footer-star">✳</span></span>
          </div>
        </main>
        <FlowInspector nodes={nodes} edges={edges} selectedNode={selectedNode} onRemoveNode={removeNode} socketStatus={socketStatus} readings={readings} />
      </div>

      {pickerOpen && (
        <GraphPicker graphs={graphs} loading={listLoading} error={listError} busyId={loadingId} onSelect={loadGraph} onRetry={fetchGraphs} onClose={closePicker} />
      )}

      {notice && (
        <div className={`toast ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
          {notice.type === 'error' ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
          <span>{notice.message}</span>
          {notice.action && <button className="toast-action" onClick={notice.action.onClick}>{notice.action.label}</button>}
          <button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
