import { Handle, Position } from '@xyflow/react';
import { ArrowUpRight, CircleDot } from 'lucide-react';
import { nodeDefinitions } from './nodeLibrary.js';

const categoryLabels = { source: 'DATA SOURCE', math: 'MATH OPERATION', action: 'ACTION TRIGGER' };

export default function FlowNode({ data, selected }) {
  const definition = nodeDefinitions[data.kind];
  const category = definition?.category || data.category || 'source';
  const Icon = definition?.icon || CircleDot;
  return (
    <div className={`flow-node ${category} ${selected ? 'is-selected' : ''}`}>
      {category !== 'source' && <Handle type="target" position={Position.Left} aria-label="Input connection" />}
      <div className="flow-node-top"><span><i />{categoryLabels[category] || 'NODE'}</span><ArrowUpRight size={14} /></div>
      <div className="flow-node-main">
        <span className={`node-icon ${category}`}><Icon size={20} strokeWidth={1.8} /></span>
        <div><strong>{data.label || definition?.label || 'Node'}</strong><small>{data.description || definition?.description || 'Flow component'}</small></div>
      </div>
      <div className="flow-node-footer"><span>{definition?.tag || 'FLOW NODE'}</span><span className="node-footer-dots">···</span></div>
      {category !== 'action' && <Handle type="source" position={Position.Right} aria-label="Output connection" />}
    </div>
  );
}
