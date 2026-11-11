import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Math: unit conversion / calibration, `value * factor + offset`. */
export default function ScaleNode({ id, data, selected }) {
  const factor = data?.config?.factor ?? 1;
  const offset = data?.config?.offset ?? 0;
  return (
    <NodeCard id={id} type="scale" data={data} selected={selected} badge={`value × ${factor} + ${offset}`}>
      <ConfigFields id={id} type="scale" data={data} />
    </NodeCard>
  );
}
