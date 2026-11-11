import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Action: mock SMS gateway (logs the message and stores an alert). */
export default function SmsAlertNode({ id, data, selected }) {
  const phone = data?.config?.phone ?? '';
  return (
    <NodeCard id={id} type="smsAlert" data={data} selected={selected} badge={phone ? `to ${phone}` : 'set a phone number'}>
      <ConfigFields id={id} type="smsAlert" data={data} />
    </NodeCard>
  );
}
