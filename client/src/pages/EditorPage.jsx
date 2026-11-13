import { useCallback, useEffect, useRef, useState } from 'react';
import { addEdge, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react';
import { AlertTriangle, CheckCircle2, ChevronRight, CircleHelp, Copy, LayoutDashboard, LoaderCircle, PencilLine, PlayCircle, RadioTower, Redo2, Square, Undo2, X } from 'lucide-react';
import FlowCanvas from '../components/canvas/FlowCanvas.jsx';
import NodePalette from '../components/canvas/NodePalette.jsx';
import { validateGraph } from '../components/canvas/graphRules.js';
import { getDefinition, initialEdges, initialNodes, makeNode, nextNodeId } from '../components/nodes/definitions.js';
import FlowInspector from '../components/FlowInspector.jsx';
import GraphPicker from '../components/GraphPicker.jsx';
import Navbar from '../components/layout/Navbar.jsx';
import ValidationPanel from '../components/ValidationPanel.jsx';
import { demoApi, errorMessage, graphApi, telemetryApi } from '../services/api.js';
import { useGraphHistory } from '../hooks/useGraphHistory.js';
import { layoutGraph } from '../services/autoLayout.js';
import { ActivityProvider } from '../components/canvas/ActivityProvider.jsx';
import TemplatesMenu from '../components/canvas/TemplatesMenu.jsx';
import DemoLivePanel from '../components/demo/DemoLivePanel.jsx';
import { copyText, downloadJson, graphFilename, serializeGraph, serializeNode, serializeEdge, toJsonString } from '../services/graphSerializer.js';
import { useTelemetry } from '../services/useTelemetry.js';
import { useChannel } from '../ws/useChannel.js';

/** Dimensions of a node card, used to centre a dropped node under the cursor. */
const NODE_OFFSET = { x: 130, y: 46 };

export default function EditorPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges.map((edge) => ({ ...edge, type: 'glowEdge' })));
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
  const [liveMode, setLiveMode] = useState(() => { try { return localStorage.getItem('nexusflow-live-mode') !== 'off'; } catch { return true; } });
  const [demoMode, setDemoMode] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [needsActivation, setNeedsActivation] = useState(false);
  const [dirty, setDirty] = useState(false);
  const history = useGraphHistory(nodes, edges, setNodes, setEdges);
  const signatureOf = (graphName, graphNodes, graphEdges) => JSON.stringify({ name: graphName, nodes: graphNodes.map(serializeNode), edges: graphEdges.map(serializeEdge) });
  const savedSignature = useRef(signatureOf('Turbine overheat rule', initialNodes, initialEdges));
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
    if (status !== 'active' && status !== 'error') setDemoMode(false); // includes automatic demo timeout
    setActivation((current) => {
      if (status === 'active') return { status: 'active', message: 'Pipeline is evaluating live telemetry.' };
      if (status === 'error') return { status: 'error', message: 'Activation failed.' };
      if (current.status !== 'inactive') return { status: 'inactive', message: 'Pipeline deactivated.' };
      return current;
    });
  }, []));

  useEffect(() => { setDirty(signatureOf(name, nodes, edges) !== savedSignature.current); }, [name, nodes, edges]);
  useEffect(() => { try { localStorage.setItem('nexusflow-live-mode', liveMode ? 'on' : 'off'); } catch { /* optional storage */ } }, [liveMode]);

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
    setEdges((current) => addEdge({ ...connection, type: 'glowEdge' }, current));
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

  const duplicateSelected = useCallback(() => {
    const selected = nodes.filter((node) => node.selected);
    if (!selected.length) { setNotice({ type: 'error', message: 'Select one or more nodes to duplicate.' }); return; }
    const ids = new Map(selected.map((node) => [node.id, nextNodeId(node.type)]));
    const clones = selected.map((node) => ({ ...node, id: ids.get(node.id), position: { x: node.position.x + 48, y: node.position.y + 48 }, data: { ...node.data, config: { ...node.data?.config } }, selected: true }));
    const internalEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({ ...edge, id: nextNodeId('edge'), source: ids.get(edge.source), target: ids.get(edge.target), type: 'glowEdge', selected: true }));
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...clones]);
    setEdges((current) => [...current.map((edge) => ({ ...edge, selected: false })), ...internalEdges]);
  }, [nodes, edges, setNodes, setEdges]);

  useEffect(() => {
    const handleKey = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const editable = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]');
      if (key === 's') { event.preventDefault(); if (!saving) saveGraph(); return; }
      if (editable) return;
      if (key === 'z') { event.preventDefault(); event.shiftKey ? history.redo() : history.undo(); }
      if (key === 'y') { event.preventDefault(); history.redo(); }
      if (key === 'd') { event.preventDefault(); duplicateSelected(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  async function autoLayout() {
    setLayoutBusy(true);
    try { const arranged = await layoutGraph(nodes, edges); setNodes(arranged); requestAnimationFrame(() => flow.fitView({ padding: 0.18, duration: 350, maxZoom: 1 })); }
    catch (error) { setNotice({ type: 'error', message: errorMessage(error) }); }
    finally { setLayoutBusy(false); }
  }

  function applyTemplate(graph) {
    const nextNodes = graph.nodes ?? [];
    const nextEdges = (graph.edges ?? []).map((edge) => ({ ...edge, type: 'glowEdge' }));
    setNodes(nextNodes); setEdges(nextEdges); setName(graph.name); setGraphId('');
    setActivation({ status: 'inactive', message: '' }); setValidation(null); setDemoMode(false); setNeedsActivation(false);
    history.reset(nextNodes, nextEdges); savedSignature.current = ''; setDirty(true);
    requestAnimationFrame(() => flow.fitView({ padding: 0.18, maxZoom: 1, duration: 300 }));
    setNotice({ type: 'success', message: 'Template loaded. Adjust it, then save and activate.' });
  }

  async function runDemo() {
    setDemoBusy(true);
    try {
      const { data } = (await demoApi.start()).data;
      const nextNodes = data.graph.nodes ?? [];
      const nextEdges = (data.graph.edges ?? []).map((edge) => ({ ...edge, type: 'glowEdge' }));
      setNodes(nextNodes); setEdges(nextEdges); setName(data.graph.name); setGraphId(data.graphId);
      history.reset(nextNodes, nextEdges); savedSignature.current = signatureOf(data.graph.name, nextNodes, nextEdges); setDirty(false);
      setActivation({ status: 'active', message: 'Demo simulator is running.' }); setNeedsActivation(false); setLiveMode(true); setDemoMode(true); setValidation(null);
      requestAnimationFrame(() => flow.fitView({ padding: 0.18, maxZoom: 0.85, duration: 400 }));
      setNotice({ type: 'success', message: data.activityEnabled ? 'Demo running — watch the alert path glow, then open Alerts → Mock Receiver.' : 'Demo running, but NODE_ACTIVITY_ENABLED is false on the server; glowing wires are disabled.' });
    } catch (error) { setNotice({ type: 'error', message: errorMessage(error) }); }
    finally { setDemoBusy(false); }
  }
  async function stopDemo() {
    setDemoBusy(true);
    try { await demoApi.stop(); setDemoMode(false); setActivation({ status: 'inactive', message: 'Demo stopped.' }); setNotice({ type: 'success', message: 'Demo simulator stopped and its graph was deactivated.' }); }
    catch (error) { setNotice({ type: 'error', message: errorMessage(error) }); }
    finally { setDemoBusy(false); }
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
      const response = graphId ? await graphApi.update(graphId, payload) : await graphApi.create(payload);
      const saved = response.data.data;
      setGraphId(saved._id);
      setNeedsActivation(Boolean(graphId));
      setActivation((current) => graphId ? { ...current, message: 'Saved changes are not live yet. Activate again to apply them.' } : { status: 'inactive', message: '' });
      setName(payload.name);
      savedSignature.current = signatureOf(payload.name, nodes, edges); setDirty(false);
      setNotice({ type: 'success', message: `Graph saved with ${payload.nodes.length} nodes and ${payload.edges.length} edges. ${graphId ? 'Activate again to apply changes.' : 'Ready to Activate.'}` });
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
      const loadedNodes = graph.nodes ?? [];
      const loadedEdges = (graph.edges ?? []).map((edge) => ({ ...edge, type: 'glowEdge' }));
      setNodes(loadedNodes); setEdges(loadedEdges);
      history.reset(loadedNodes, loadedEdges);
      setName(graph.name ?? 'Untitled graph');
      savedSignature.current = signatureOf(graph.name ?? 'Untitled graph', loadedNodes, loadedEdges); setDirty(false);
      setGraphId(id); setNeedsActivation(false); setDemoMode(false);
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
      setNeedsActivation(false);
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
        allowRecompile={needsActivation}
      />

      <div className="editor-body">
        <NodePalette onAddNode={handlePaletteClick} />
        <main className={`work-area ${demoMode ? 'demo-split' : ''}`}>
          <div className="work-header">
            <div className="work-title">
              <div className="work-breadcrumb"><span>WORKSPACE</span><ChevronRight size={12} /><span>FLOW EDITOR</span></div>
              <div className="name-row">
                <input ref={nameRef} aria-label="Graph name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
                <PencilLine size={15} />
                <span className="draft-badge"><i /> {dirty ? 'UNSAVED' : graphId ? 'SAVED' : 'DRAFT'}</span>
              </div>
              <p>Bring your data and ideas together, one node at a time.</p>
            </div>
            <div className="work-meta">
              <div><strong>{String(nodes.length).padStart(2, '0')}</strong><span>NODES</span></div>
              <i />
              <div><strong>{String(edges.length).padStart(2, '0')}</strong><span>CONNECTIONS</span></div>
            </div>
          </div>

          <div className="editor-toolbar" aria-label="Canvas tools">
            <div className="tool-group"><button className="button button-ghost icon-button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!history.canUndo} onClick={history.undo}><Undo2 size={16} /></button><button className="button button-ghost icon-button" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!history.canRedo} onClick={history.redo}><Redo2 size={16} /></button><button className="button button-ghost" title="Duplicate selected nodes (Ctrl+D)" onClick={duplicateSelected}><Copy size={14} /><span>Duplicate</span></button><button className="button button-ghost" onClick={autoLayout} disabled={layoutBusy}>{layoutBusy ? <LoaderCircle size={14} className="spin" /> : <LayoutDashboard size={14} />}<span>Auto-layout</span></button><TemplatesMenu onSelect={applyTemplate} /></div>
            <div className="tool-group"><button className={`button button-ghost live-toggle ${liveMode ? 'enabled' : ''}`} aria-pressed={liveMode} onClick={() => setLiveMode(!liveMode)} title="Toggle canvas glow effects"><RadioTower size={14} /> Live Mode <span className="toggle-track"><i /></span></button>{demoMode ? <button className="button button-ghost" onClick={stopDemo} disabled={demoBusy}><Square size={14} /> Stop Demo</button> : <button className="button button-demo" onClick={runDemo} disabled={demoBusy}>{demoBusy ? <LoaderCircle size={15} className="spin" /> : <PlayCircle size={15} />}{demoBusy ? 'Starting…' : 'Run Demo'}</button>}</div>
          </div>

          {validation && (
            <ValidationPanel
              result={validation.result}
              source={validation.source}
              onClose={() => setValidation(null)}
              onSelectNode={focusNode}
            />
          )}

          <ActivityProvider graphId={graphId} nodes={nodes} edges={edges} liveMode={liveMode}>
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
          </ActivityProvider>
          {demoMode && <DemoLivePanel deviceId={nodes.find((node) => node.type === 'sensor')?.data?.config?.deviceId || 'turbine-001'} sensorType={nodes.find((node) => node.type === 'sensor')?.data?.config?.sensorType || 'temperature'} threshold={Number(nodes.find((node) => node.type === 'threshold')?.data?.config?.value ?? 80)} />}

          <div className="workspace-footer">
            <span><i /> CANVAS MODE <b> / </b> FLOW EDITOR</span>
            <span><CircleHelp size={14} /> Delete · Ctrl+S save · Ctrl+Z undo · Ctrl+Y redo · Ctrl+D duplicate</span>
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
