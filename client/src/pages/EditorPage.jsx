import { useCallback, useEffect, useRef, useState } from 'react';
import { addEdge, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react';
import { AlertTriangle, CheckCircle2, ChevronRight, CircleHelp, PencilLine, X } from 'lucide-react';
import FlowCanvas from '../components/canvas/FlowCanvas.jsx';
import NodePalette from '../components/canvas/NodePalette.jsx';
import { initialEdges, initialNodes, makeNode, nodeDefinitions } from '../components/canvas/nodeLibrary.js';
import FlowInspector from '../components/FlowInspector.jsx';
import GraphPicker from '../components/GraphPicker.jsx';
import Navbar from '../components/layout/Navbar.jsx';
import { errorMessage, graphApi } from '../services/api.js';
import { useTelemetry } from '../services/useTelemetry.js';

export default function EditorPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [name, setName] = useState('Turbine monitoring');
  const [health, setHealth] = useState('checking');
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [graphs, setGraphs] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [loadingId, setLoadingId] = useState('');
  const [notice, setNotice] = useState(null);
  const canvasRef = useRef(null);
  const nameRef = useRef(null);
  const flow = useReactFlow();
  const { socketStatus, readings } = useTelemetry();
  const selectedNode = nodes.find((node) => node.selected);

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
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const onConnect = useCallback((connection) => setEdges((current) => addEdge({ ...connection, type: 'smoothstep' }, current)), [setEdges]);

  function addNode(kind, position) {
    if (!nodeDefinitions[kind]) return;
    const id = `${kind}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    setNodes((current) => [...current, makeNode(kind, position, id)]);
  }

  function handleDrop(event) {
    event.preventDefault();
    const kind = event.dataTransfer.getData('application/nexusflow-node');
    if (!nodeDefinitions[kind]) return;
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addNode(kind, { x: position.x - 110, y: position.y - 40 });
  }

  function handlePaletteClick(kind) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const position = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    addNode(kind, { x: position.x - 110, y: position.y - 40 });
  }

  function removeNode(id) {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
  }

  async function saveGraph() {
    if (!name.trim()) {
      setNotice({ type: 'error', message: 'Give your graph a name before saving.' });
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const { nodes: savedNodes, edges: savedEdges, viewport } = flow.toObject();
      await graphApi.create({ name: name.trim(), nodes: savedNodes, edges: savedEdges, viewport });
      setName(name.trim());
      setNotice({ type: 'success', message: 'Graph saved. Nice work!' });
    } catch (error) { setNotice({ type: 'error', message: errorMessage(error) }); }
    finally { setSaving(false); }
  }

  async function fetchGraphs() {
    setListLoading(true);
    setListError('');
    try { const response = await graphApi.list(); setGraphs(response.data.data); }
    catch (error) { setListError(errorMessage(error)); }
    finally { setListLoading(false); }
  }

  function openPicker() { setPickerOpen(true); fetchGraphs(); }
  const closePicker = useCallback(() => setPickerOpen(false), []);

  async function loadGraph(id) {
    setLoadingId(id);
    try {
      const response = await graphApi.get(id);
      const graph = response.data.data;
      setNodes(graph.nodes);
      setEdges(graph.edges);
      setName(graph.name);
      setPickerOpen(false);
      // Wait for controlled nodes to render before restoring the saved viewport.
      requestAnimationFrame(() => {
        if (graph.viewport) flow.setViewport(graph.viewport, { duration: 300 });
        else flow.fitView({ padding: 0.24, maxZoom: 1, duration: 300 });
      });
      setNotice({ type: 'success', message: 'Graph loaded onto your canvas.' });
    } catch (error) { setListError(errorMessage(error)); }
    finally { setLoadingId(''); }
  }

  return (
    <div className="app-shell">
      <Navbar health={health} onSave={saveGraph} onLoad={openPicker} saving={saving} />
      <div className="editor-body">
        <NodePalette onAddNode={handlePaletteClick} />
        <main className="work-area">
          <div className="work-header">
            <div className="work-title">
              <div className="work-breadcrumb"><span>WORKSPACE</span><ChevronRight size={12} /><span>FLOW EDITOR</span></div>
              <div className="name-row"><input ref={nameRef} aria-label="Graph name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /><PencilLine size={15} /><span className="draft-badge"><i /> DRAFT</span></div>
              <p>Bring your data and ideas together, one node at a time.</p>
            </div>
            <div className="work-meta"><div><strong>{String(nodes.length).padStart(2, '0')}</strong><span>NODES</span></div><i /><div><strong>{String(edges.length).padStart(2, '0')}</strong><span>CONNECTIONS</span></div></div>
          </div>
          <FlowCanvas nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onDrop={handleDrop} canvasRef={canvasRef} />
          <div className="workspace-footer"><span><i /> CANVAS MODE <b> / </b> FLOW EDITOR</span><span><CircleHelp size={14} /> Select a node or edge and press Delete to remove it.</span><span>MADE TO FLOW <span className="footer-star">✳</span></span></div>
        </main>
        <FlowInspector nodes={nodes} edges={edges} selectedNode={selectedNode} onRemoveNode={removeNode} socketStatus={socketStatus} readings={readings} />
      </div>
      {pickerOpen && <GraphPicker graphs={graphs} loading={listLoading} error={listError} busyId={loadingId} onSelect={loadGraph} onRetry={fetchGraphs} onClose={closePicker} />}
      {notice && <div className={`toast ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.type === 'error' ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}<span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={16} /></button></div>}
    </div>
  );
}
