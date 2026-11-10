import { ArrowUpRight, Check, Circle, Layers2, Radio, Trash2, Workflow } from 'lucide-react';
import { nodeDefinitions } from './canvas/nodeLibrary.js';

export default function FlowInspector({ nodes, edges, selectedNode, onRemoveNode, socketStatus, readings }) {
  const steps = [
    { label: 'Add a data source', complete: nodes.some((node) => node.data?.category === 'source') },
    { label: 'Add an operation', complete: nodes.some((node) => node.data?.category === 'math') },
    { label: 'Choose an action', complete: nodes.some((node) => node.data?.category === 'action') },
  ];
  const socketText = socketStatus === 'connected' ? 'LIVE' : socketStatus === 'connecting' ? 'CONNECTING' : 'OFFLINE';
  const selectedDefinition = selectedNode && nodeDefinitions[selectedNode.data?.kind];

  return (
    <aside className="inspector" aria-label="Flow details">
      <div className="inspector-heading"><span className="eyebrow">THE BIG PICTURE</span><span className="inspector-number">01 / 01</span></div>
      <div className="inspector-title"><div><h2>Flow overview<span className="heading-period">.</span></h2><p>A little clarity goes a long way.</p></div><ArrowUpRight size={17} /></div>
      <div className="stats-grid">
        <div className="stat-card"><span className="stat-icon"><Layers2 size={15} /></span><strong>{String(nodes.length).padStart(2, '0')}</strong><small>Nodes</small></div>
        <div className="stat-card"><span className="stat-icon"><Workflow size={15} /></span><strong>{String(edges.length).padStart(2, '0')}</strong><small>Connections</small></div>
      </div>

      {selectedNode ? (
        <section className="inspector-section selected-section">
          <div className="section-label"><span>SELECTED NODE</span><span>DETAILS</span></div>
          <div className="selected-node-title">{selectedNode.data?.label || 'Node'}</div>
          <p>{selectedNode.data?.description || selectedDefinition?.description || 'A component in your flow.'}</p>
          <button className="remove-node" onClick={() => onRemoveNode(selectedNode.id)}><Trash2 size={14} /> Remove node</button>
        </section>
      ) : (
        <section className="inspector-section">
          <div className="section-label"><span>BUILDING YOUR FLOW</span><span>03 STEPS</span></div>
          <div className="checklist">
            {steps.map((step) => <div className="checklist-row" key={step.label}>
              <span className={`check-circle ${step.complete ? 'done' : ''}`}>{step.complete ? <Check size={12} /> : <Circle size={10} />}</span>
              <span>{step.label}</span><span className="checklist-state">{step.complete ? 'ADDED' : 'TO DO'}</span>
            </div>)}
          </div>
        </section>
      )}

      <section className="inspector-section telemetry-section">
        <div className="section-label"><span>LIVE TELEMETRY</span><span className={`socket-badge ${socketStatus}`}><i />{socketText}</span></div>
        {readings.length ? (
          <div className="reading-list">
            {readings.map((reading, index) => <div className="reading-row" key={`${reading._id || reading.timestamp}-${index}`}>
              <span className="reading-icon"><Radio size={14} /></span>
              <span className="reading-copy"><strong>{reading.metadata?.sensorType || 'Sensor'}</strong><small>{reading.metadata?.deviceId || 'Device'}</small></span>
              <span className="reading-value tabular-nums">{typeof reading.value === 'number' ? reading.value.toFixed(1) : '—'} <small>{reading.unit}</small></span>
            </div>)}
          </div>
        ) : (
          <div className="telemetry-empty"><span className="telemetry-empty-icon"><Radio size={17} /></span><strong>Listening for data</strong><p>Run the simulator to see readings arrive here in real time.</p><code>npm run simulate</code></div>
        )}
      </section>
      <div className="inspector-note"><span className="note-star">✳</span><div><strong>Just the beginning.</strong><p>Graphs are saved today. Live rule execution is coming in a future milestone.</p></div></div>
    </aside>
  );
}
