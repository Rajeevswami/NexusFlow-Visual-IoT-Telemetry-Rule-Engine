import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';
export default function EmailNode({ id, data, selected }) {
  return <NodeCard id={id} type="email" data={data} selected={selected} badge={data?.config?.to || 'set a recipient'}><ConfigFields id={id} type="email" data={data} /></NodeCard>;
}
