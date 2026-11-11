import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Data source: the entry point of a pipeline. Only has an output handle. */
export default function SensorNode({ id, data, selected }) {
  const deviceId = data?.config?.deviceId ?? 'unknown';
  const sensorType = data?.config?.sensorType ?? 'unknown';
  return (
    <NodeCard id={id} type="sensor" data={data} selected={selected} badge={`${deviceId} · ${sensorType}`}>
      <ConfigFields id={id} type="sensor" data={data} />
    </NodeCard>
  );
}
