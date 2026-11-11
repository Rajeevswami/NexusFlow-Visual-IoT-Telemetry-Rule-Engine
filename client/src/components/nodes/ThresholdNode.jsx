import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Math: forwards a reading only when `value <operator> threshold`. */
export default function ThresholdNode({ id, data, selected }) {
  const operator = data?.config?.operator ?? '>';
  const value = data?.config?.value ?? 0;
  return (
    <NodeCard id={id} type="threshold" data={data} selected={selected} badge={`fires when value ${operator} ${value}`}>
      <ConfigFields id={id} type="threshold" data={data} />
    </NodeCard>
  );
}
