import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Action: HTTP call with a 3 second timeout; failures never break the pipeline. */
export default function WebhookNode({ id, data, selected }) {
  const method = data?.config?.method ?? 'POST';
  const url = data?.config?.url ?? '';
  return (
    <NodeCard id={id} type="webhook" data={data} selected={selected} badge={`${method} ${url}`}>
      <ConfigFields id={id} type="webhook" data={data} />
    </NodeCard>
  );
}
