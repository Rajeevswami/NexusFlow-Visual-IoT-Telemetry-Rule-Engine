import { GripVertical, MousePointer2, Search, X } from 'lucide-react';
import { useState } from 'react';
import { groups } from './nodeLibrary.js';

export default function NodePalette({ onAddNode }) {
  const [search, setSearch] = useState('');
  const matches = groups.map((group) => ({
    ...group,
    nodes: group.nodes.filter((node) => `${node.label} ${node.description}`.toLowerCase().includes(search.toLowerCase().trim())),
  })).filter((group) => group.nodes.length);

  function startDrag(event, kind) {
    event.dataTransfer.setData('application/nexusflow-node', kind);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <aside className="palette" aria-label="Node palette">
      <div className="palette-heading">
        <span className="eyebrow"><span className="eyebrow-line" /> THE BUILDING BLOCKS</span>
        <h2>Node palette<span className="heading-period">.</span></h2>
        <p>Drag a node onto the canvas to start building your flow.</p>
        <label className="palette-search">
          <Search size={15} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a node..." aria-label="Find a node" />
          {search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}
          {!search && <span className="search-shortcut">/</span>}
        </label>
      </div>
      <div className="palette-groups">
        {matches.length === 0 && <p className="palette-empty">No nodes match “{search}”.</p>}
        {matches.map((group) => (
          <section className="palette-group" key={group.id}>
            <div className="group-heading"><h3>{group.label}</h3><span>{String(group.nodes.length).padStart(2, '0')}</span></div>
            <div className="palette-items">
              {group.nodes.map((node) => (
                <button type="button" className="palette-item" key={node.kind} draggable
                  onDragStart={(event) => startDrag(event, node.kind)} onClick={() => onAddNode(node.kind)}
                  title={`Drag or click to add ${node.label}`}>
                  <span className={`node-icon ${node.category}`}><node.icon size={18} strokeWidth={1.8} /></span>
                  <span className="palette-item-copy"><strong>{node.label}</strong><small className="truncate">{node.description}</small></span>
                  <GripVertical className="grip" size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="palette-tip">
        <span className="tip-icon"><MousePointer2 size={15} /></span>
        <div><strong>A little tip</strong><p>Drag to add, or click a node to place it on your canvas.</p></div>
      </div>
      <div className="palette-footer"><span>YOUR IDEAS, CONNECTED</span><span>✳</span></div>
    </aside>
  );
}
