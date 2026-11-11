import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Math: sliding-window average over `windowSize` readings. */
export default function MovingAverageNode({ id, data, selected }) {
  const windowSize = data?.config?.windowSize ?? 5;
  return (
    <NodeCard id={id} type="movingAverage" data={data} selected={selected} badge={`average of last ${windowSize} readings`}>
      <ConfigFields id={id} type="movingAverage" data={data} />
    </NodeCard>
  );
}
