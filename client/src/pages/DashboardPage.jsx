import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, X } from 'lucide-react';
import AlertFeed from '../components/dashboard/AlertFeed.jsx';
import EngineStatus from '../components/dashboard/EngineStatus.jsx';
import LiveLineChart from '../components/dashboard/LiveLineChart.jsx';
import StatCards from '../components/dashboard/StatCards.jsx';
import NavLinks from '../components/layout/NavLinks.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { useTelemetrySeries } from '../hooks/useTelemetrySeries.js';
import { errorMessage, graphApi, telemetryApi } from '../services/api.js';
import { useWebSocket } from '../ws/WebSocketProvider.jsx';
import { useChannel } from '../ws/useChannel.js';

const MAX_ALERTS = 50;
const TOAST_MS = 6000;

/**
 * Live dashboard: device selector, rolling chart, stat cards, alert feed (with
 * toast) and the engine status panel. All live data arrives through channel
 * subscriptions on the shared WebSocket; heavy telemetry is buffered by
 * `useTelemetrySeries` so React never re-renders per message.
 */
export default function DashboardPage() {
  const ws = useWebSocket();
  const [devices, setDevices] = useState([]);
  const [device, setDevice] = useState('');
  const [sensorType, setSensorType] = useState('temperature');
  const [alerts, setAlerts] = useState([]);
  const [toast, setToast] = useState(null);
  const [threshold, setThreshold] = useState(null);
  const [loadError, setLoadError] = useState('');

  // ------------------------------------------------- device list (graphs + telemetry)
  useEffect(() => {
    let mounted = true;
    async function loadDevices() {
      const found = new Map(); // deviceId -> sensorTypes
      const add = (deviceId, sensorType) => {
        if (!deviceId || deviceId === '*') return;
        if (!found.has(deviceId)) found.set(deviceId, new Set());
        if (sensorType && sensorType !== '*') found.get(deviceId).add(sensorType);
      };
      try {
        const active = (await graphApi.active()).data.data;
        for (const entry of active) for (const source of entry.sources ?? []) add(source.deviceId, source.sensorType);
      } catch { /* backend offline: fall back to recent telemetry */ }
      try {
        const recent = (await telemetryApi.readings({ limit: 200 })).data.data;
        for (const reading of recent) add(reading.metadata?.deviceId, reading.metadata?.sensorType);
      } catch (error) { if (mounted) setLoadError(errorMessage(error)); }
      if (!mounted) return;
      const list = [...found.entries()].map(([deviceId, sensors]) => ({ deviceId, sensors: [...sensors].sort() }));
      setDevices(list);
      setDevice((current) => current || list[0]?.deviceId || '');
    }
    loadDevices();
    return () => { mounted = false; };
  }, []);

  // ------------------------------------------------- threshold from active rule graphs
  useEffect(() => {
    let mounted = true;
    let cancelled = false;
    async function loadThreshold() {
      setThreshold(null);
      if (!device) return;
      try {
        const active = (await graphApi.active()).data.data;
        for (const entry of active) {
          if (cancelled || !mounted) return;
          const graph = (await graphApi.get(entry.graphId)).data.data;
          const node = (graph.nodes ?? []).find((n) => n.type === 'threshold'
            && (n.data?.config?.deviceId ?? '*') === device
            && (n.data?.config?.sensorType ?? '*') === sensorType);
          if (node?.data?.config?.value !== undefined && !cancelled) {
            setThreshold({ operator: node.data.config.operator ?? '>', value: Number(node.data.config.value) });
            return;
          }
        }
      } catch { /* no active graphs or backend offline: chart runs without a line */ }
    }
    loadThreshold();
    return () => { mounted = false; cancelled = true; };
  }, [device, sensorType]);

  // ------------------------------------------------- live series (buffered, 200 ms)
  const channel = device ? `telemetry:${device}` : null;
  const { points, stats, messagesPerSecond, pointCount } = useTelemetrySeries(channel, { sensorType, maxPoints: 60 });

  // ------------------------------------------------- alert feed + toast
  const handleAlert = useCallback((message) => {
    const alert = message.data;
    if (!alert) return;
    setAlerts((current) => [alert, ...current].slice(0, MAX_ALERTS));
    setToast({ ...alert, key: `${alert.triggeredAt}-${Math.random().toString(36).slice(2, 7)}` });
  }, []);
  useChannel('alerts', handleAlert);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // Historical alerts so the feed is not empty on first load.
  useEffect(() => {
    let mounted = true;
    telemetryApi.alerts({ limit: 30 })
      .then((response) => { if (mounted) setAlerts(response.data.data ?? []); })
      .catch(() => { /* feed starts empty when the API is unreachable */ });
    return () => { mounted = false; };
  }, []);

  const sensorOptions = useMemo(() => {
    const entry = devices.find((d) => d.deviceId === device);
    return entry?.sensors?.length ? entry.sensors : ['temperature', 'vibration', 'pressure'];
  }, [devices, device]);

  useEffect(() => {
    if (!sensorOptions.includes(sensorType)) setSensorType(sensorOptions[0]);
  }, [sensorOptions, sensorType]);

  const unit = points[points.length - 1]?.unit || '';

  return (
    <div className="dashboard-page">
      <header className="dashboard-topbar">
        <div className="brand select-none">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
          <div className="brand-copy"><strong>NexusFlow<span>.</span></strong><small>LIVE DASHBOARD</small></div>
        </div>
        <NavLinks />
        <ThemeToggle />
        <div className="dashboard-topbar-meta">
          <span className={`health ${ws?.status === 'connected' ? 'online' : ws?.status === 'disconnected' ? 'offline' : 'checking'}`} role="status">
            <span className="health-dot" />
            {ws?.status === 'connected' ? 'Stream live' : ws?.status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          </span>
        </div>
      </header>

      <main className="dashboard-body">
        <section className="dashboard-controls panel">
          <div className="control-group">
            <label htmlFor="device-select">Device</label>
            <select id="device-select" value={device} onChange={(event) => setDevice(event.target.value)}>
              {devices.length === 0 && <option value="">No devices yet</option>}
              {devices.map((entry) => <option key={entry.deviceId} value={entry.deviceId}>{entry.deviceId}</option>)}
            </select>
          </div>
          <div className="control-group">
            <label htmlFor="sensor-select">Sensor</label>
            <select id="sensor-select" value={sensorType} onChange={(event) => setSensorType(event.target.value)}>
              {sensorOptions.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <div className="control-group control-info">
            <label>Rolling window</label>
            <span className="tabular-nums">last {pointCount} / 60 points · {messagesPerSecond} msg/s</span>
          </div>
          {threshold && (
            <div className="threshold-chip" title="Threshold rule from the active graph">
              rule: {threshold.operator} {threshold.value}
            </div>
          )}
          {loadError && <div className="control-error">{loadError}</div>}
        </section>

        <div className="dashboard-grid">
          <section className="panel chart-panel">
            <header className="panel-header">
              <span className="panel-title"><Activity size={15} /> {device || '—'} · {sensorType}</span>
              <span className="panel-meta">{unit || 'live'}</span>
            </header>
            <LiveLineChart points={points} threshold={threshold} unit={unit} />
          </section>

          <StatCards stats={stats} messagesPerSecond={messagesPerSecond} pointCount={pointCount} unit={unit} />

          <AlertFeed alerts={alerts} />
          <EngineStatus status={ws?.status ?? 'connecting'} />
        </div>
      </main>

      {toast && (
        <div className={`toast alert-toast ${toast.severity === 'critical' ? 'error' : 'success'}`} role="alert">
          <span className="alert-toast-dot" />
          <span><strong>{toast.deviceId}</strong> — {toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss alert"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
