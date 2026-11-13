import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Action: mock SMS by default; provider selection is server-side configuration. */
export default function SmsAlertNode({ id, data, selected }) {
  return (
    <NodeCard id={id} type="smsAlert" data={data} selected={selected} badge="Mock / Twilio · delivery tracked">
      <ConfigFields id={id} type="smsAlert" data={data} />
    </NodeCard>
  );
}
