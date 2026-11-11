import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Action: prints the reading to the server console — the cheapest way to debug a graph. */
export default function LogNode({ id, data, selected }) {
  const prefix = data?.config?.label ?? 'pipeline';
  return (
    <NodeCard id={id} type="log" data={data} selected={selected} badge={`console · ${prefix}`}>
      <ConfigFields id={id} type="log" data={data} />
    </NodeCard>
  );
}
