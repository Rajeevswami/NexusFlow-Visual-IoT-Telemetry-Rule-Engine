import { Handle, Position } from '@xyflow/react';
import { ArrowUpRight } from 'lucide-react';
import { CATEGORIES, getDefinition } from './definitions.js';
import { useNodeActivity } from '../canvas/ActivityProvider.jsx';

/** Shared card shell. The activity hook updates this card only, never the canvas. */
export default function NodeCard({ id, type, data, selected, children, badge }) {
  const definition = getDefinition(type);
  const category = definition?.category ?? data?.category ?? 'source';
  const meta = CATEGORIES[category] ?? CATEGORIES.source;
  const Icon = definition?.icon;
  const activity = useNodeActivity(id);
  const value = Number.isFinite(activity?.value) ? `${activity.label}: ${Number(activity.value.toFixed(1))}${activity.unit ? ` ${activity.unit}` : ''}` : null;
  return (
    <div className="node-activity-shell">
      <div className={`flow-node ${category} ${selected ? 'is-selected' : ''} ${activity?.active ? `node-pulse ${activity.tone}` : ''}`} data-node-type={type}>
        {definition?.hasInput && <Handle type="target" position={Position.Left} aria-label="Input connection" />}
        <div className="flow-node-top"><span><i style={{ background: meta.color }} />{meta.label.toUpperCase()}</span><ArrowUpRight size={14} /></div>
        <div className="flow-node-main">
          {Icon && <span className={`node-icon ${category}`}><Icon size={20} strokeWidth={1.8} /></span>}
          <div className="node-headings"><strong>{data?.label || definition?.label || 'Node'}</strong><small>{badge ?? data?.description ?? definition?.description}</small></div>
        </div>
        {children}
        <div className="flow-node-footer"><span>{definition?.tag ?? 'FLOW NODE'}</span><span className="node-footer-dots">···</span></div>
        {definition?.hasOutput && <Handle type="source" position={Position.Right} aria-label="Output connection" />}
      </div>
      {value && <div className={`node-activity-badge ${activity.tone}`} aria-label={`Latest processed value ${value}`}>{value}</div>}
    </div>
  );
}
