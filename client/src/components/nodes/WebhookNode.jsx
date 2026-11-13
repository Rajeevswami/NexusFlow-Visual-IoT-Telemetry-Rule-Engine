import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Action: configurable HTTP request; retries and auditing live on the server. */
export default function WebhookNode({ id, data, selected }) {
  const method = data?.config?.method ?? 'POST';
  return (
    <NodeCard id={id} type="webhook" data={data} selected={selected} badge={`${method} · 5s timeout · 3 attempts`}>
      <ConfigFields id={id} type="webhook" data={data} />
    </NodeCard>
  );
}
