import { useCallback, useEffect, useState } from 'react';
import { Activity, Radio } from 'lucide-react';
import { useTelemetrySeries } from '../../hooks/useTelemetrySeries.js';
import { telemetryApi } from '../../services/api.js';
import { useChannel } from '../../ws/useChannel.js';
import LiveLineChart from '../dashboard/LiveLineChart.jsx';
import AlertFeed from '../dashboard/AlertFeed.jsx';

export default function DemoLivePanel({ deviceId = 'turbine-001', sensorType = 'temperature', threshold = 80 }) {
  const { points, messagesPerSecond } = useTelemetrySeries(`telemetry:${deviceId}`, { sensorType, maxPoints: 60 });
  const [alerts, setAlerts] = useState([]);
  useEffect(() => {
    let mounted = true;
    telemetryApi.alerts({ limit: 15 }).then((response) => { if (mounted) setAlerts(response.data.data); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  useChannel('alerts', useCallback((message) => {
    if (message.type === 'alert') setAlerts((current) => [message.data, ...current].slice(0, 20));
  }, []));
  return <section className="demo-live-panel" aria-label="Live demo split view">
    <div className="demo-chart panel"><header className="panel-header"><span className="panel-title"><Activity size={15} /> {deviceId} · {sensorType}</span><span className="panel-meta">{messagesPerSecond} msg/s</span></header>
      {points.length ? <LiveLineChart points={points} threshold={{ operator: '>', value: threshold }} unit={points.at(-1)?.unit} height={220} /> : <div className="demo-waiting"><Radio size={22} /><span>Waiting for the first demo reading…</span></div>}
    </div><AlertFeed alerts={alerts} />
  </section>;
}
