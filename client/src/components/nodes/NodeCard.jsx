import { Handle, Position } from '@xyflow/react';
import { ArrowUpRight } from 'lucide-react';
import { CATEGORIES, getDefinition } from './definitions.js';

/**
 * Shared card shell for every custom node.
 *
 * Handles are driven by the node definition: sources expose only an output, actions only
 * an input, math nodes both. Children are the node's config fields.
 */
export default function NodeCard({ id, type, data, selected, children, badge }) {
  const definition = getDefinition(type);
  const category = definition?.category ?? data?.category ?? 'source';
  const meta = CATEGORIES[category] ?? CATEGORIES.source;
  const Icon = definition?.icon;

  return (
    <div className={`flow-node ${category} ${selected ? 'is-selected' : ''}`} data-node-type={type}>
      {definition?.hasInput && <Handle type="target" position={Position.Left} aria-label="Input connection" />}

      <div className="flow-node-top">
        <span><i style={{ background: meta.color }} />{meta.label.toUpperCase()}</span>
        <ArrowUpRight size={14} />
      </div>

      <div className="flow-node-main">
        {Icon && (
          <span className={`node-icon ${category}`}>
            <Icon size={20} strokeWidth={1.8} />
          </span>
        )}
        <div className="node-headings">
          <strong>{data?.label || definition?.label || 'Node'}</strong>
          <small>{badge ?? data?.description ?? definition?.description}</small>
        </div>
      </div>

      {children}

      <div className="flow-node-footer">
        <span>{definition?.tag ?? 'FLOW NODE'}</span>
        <span className="node-footer-dots">···</span>
      </div>

      {definition?.hasOutput && <Handle type="source" position={Position.Right} aria-label="Output connection" />}
    </div>
  );
}
