import { memo } from 'react';
import { BaseEdge, getBezierPath } from '@xyflow/react';
import { useEdgeActivity } from './ActivityProvider.jsx';

/** Only this edge subscribes to its activity; the canvas does not re-render on WS frames. */
function AnimatedEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, style }) {
  const activity = useEdgeActivity(id);
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const color = activity?.tone === 'alert' ? '#ef6461' : '#22a7e0';
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={20}
    className={`glow-edge ${activity ? 'is-active' : ''} ${activity?.tone ?? 'data'}`}
    style={{ ...style, stroke: activity ? color : selected ? '#177b79' : 'var(--edge-color, #94aaa9)', strokeWidth: activity ? 2.8 : 2,
      strokeDasharray: activity ? '8 6' : undefined, filter: activity ? `drop-shadow(0 0 5px ${color})` : 'none' }} />;
}
export default memo(AnimatedEdge);
