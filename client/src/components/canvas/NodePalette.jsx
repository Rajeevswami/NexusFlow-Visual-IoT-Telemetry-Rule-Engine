import { GripVertical, MousePointer2, Search, X } from 'lucide-react';
import { useState } from 'react';
import { PALETTE_GROUPS, getDefinition } from '../nodes/definitions.js';

/**
 * Left sidebar: every palette entry is draggable (HTML5 drag & drop, read by the canvas)
 * and clickable (drops the node in the middle of the viewport).
 */
export default function NodePalette({ onAddNode }) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const matches = PALETTE_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(query)),
  })).filter((group) => group.items.length);

  function startDrag(event, item) {
    event.dataTransfer.setData('application/nexusflow-node', JSON.stringify({ type: item.type, config: item.config }));
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
            <div className="group-heading"><h3>{group.label}</h3><span>{String(group.items.length).padStart(2, '0')}</span></div>
            <div className="palette-items">
              {group.items.map((item) => {
                const definition = getDefinition(item.type);
                const Icon = definition?.icon;
                return (
                  <button
                    type="button"
                    className={`palette-item ${definition?.category ?? ''}`}
                    key={`${group.id}-${item.label}`}
                    draggable
                    onDragStart={(event) => startDrag(event, item)}
                    onClick={() => onAddNode(item.type, item.config)}
                    title={`Drag or click to add ${item.label}`}
                  >
                    <span className={`node-icon ${definition?.category ?? ''}`}>
                      {Icon ? <Icon size={18} strokeWidth={1.8} /> : null}
                    </span>
                    <span className="palette-item-copy">
                      <strong>{item.label}</strong>
                      <small className="truncate">{item.description}</small>
                    </span>
                    <GripVertical className="grip" size={15} aria-hidden="true" />
                  </button>
                );
              })}
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
