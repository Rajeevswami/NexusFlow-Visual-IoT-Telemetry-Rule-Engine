import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, Inbox, RefreshCw, RotateCcw, Send, TriangleAlert } from 'lucide-react';
import NavLinks from '../components/layout/NavLinks.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import Skeleton from '../components/Skeleton.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { deliveryApi, errorMessage, graphApi, telemetryApi } from '../services/api.js';
import { useChannel } from '../ws/useChannel.js';

const time = (value) => value ? new Date(value).toLocaleString() : '—';
function StatusBadge({ status }) { return <span className={`delivery-badge ${status || 'untracked'}`}><i />{status || 'not tracked'}</span>; }

export default function AlertsPage() {
  const [tab, setTab] = useState('alerts');
  const [alerts, setAlerts] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [payloads, setPayloads] = useState([]);
  const [graphs, setGraphs] = useState([]);
  const [filters, setFilters] = useState({ graphId: '', deviceId: '', from: '', to: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(new Set());
  const refreshTimer = useRef(null);
  const revision = useRef(0);
  const notify = useToast();
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const load = useCallback(async () => {
    const version = ++revision.current;
    setLoading(true); setError('');
    const params = { limit: 200 };
    if (filters.graphId) params.graphId = filters.graphId;
    if (filters.deviceId.trim()) params.deviceId = filters.deviceId.trim();
    if (filters.from) params.from = new Date(`${filters.from}T00:00:00`).toISOString();
    if (filters.to) params.to = new Date(`${filters.to}T23:59:59.999`).toISOString();
    try {
      const [graphResponse, alertResponse, deliveryResponse] = await Promise.all([
        graphApi.list(), telemetryApi.alerts(params), deliveryApi.list({ limit: 500, ...(filters.graphId ? { graphId: filters.graphId } : {}), ...(filters.status ? { status: filters.status } : {}) }),
      ]);
      if (version !== revision.current) return;
      setGraphs(graphResponse.data.data); setAlerts(alertResponse.data.data); setDeliveries(deliveryResponse.data.data);
      if (tab === 'receiver') setPayloads((await deliveryApi.receiver()).data.data);
    } catch (caught) { if (version === revision.current) setError(errorMessage(caught)); }
    finally { if (version === revision.current) setLoading(false); }
  }, [filters, tab]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { graphApi.list().then((response) => setGraphs(response.data.data)).catch(() => {}); }, []);
  useChannel('alerts', useCallback((message) => {
    if (!['alert', 'delivery'].includes(message.type)) return;
    clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(load, 400);
  }, [load]));
  useEffect(() => () => clearTimeout(refreshTimer.current), []);
  async function retry(id) {
    setRetrying((current) => new Set(current).add(id));
    try { await deliveryApi.retry(id); notify('Retry queued. Delivery status will update automatically.'); await load(); }
    catch (caught) { notify(errorMessage(caught), 'error'); }
    finally { setRetrying((current) => { const next = new Set(current); next.delete(id); return next; }); }
  }
  const visibleAlerts = alerts.filter((alert) => !filters.status || alert.deliveryStatus === filters.status);
  const failedFor = (alert) => deliveries.find((delivery) => String(delivery.alertId) === String(alert._id) && delivery.status === 'failed');
  return <div className="alerts-page">
    <header className="dashboard-topbar"><div className="brand select-none"><div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div><div className="brand-copy"><strong>NexusFlow<span>.</span></strong><small>ALERTS & DELIVERIES</small></div></div><NavLinks /><ThemeToggle /><button className="button button-ghost ml-auto" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh</button></header>
    <main className="alerts-body">
      <div className="alerts-heading"><div><span className="eyebrow">EVERY SIGNAL, ACCOUNTED FOR</span><h1>Alerts & deliveries<span className="heading-period">.</span></h1><p>Follow an alert from rule evaluation to its final outbound attempt.</p></div><div className="audit-note"><Inbox size={18} /><span>Persisted audit trail<small>Mock providers are clearly labelled in server logs.</small></span></div></div>
      <section className="panel alerts-controls" aria-label="Filters">
        <label>Graph<select value={filters.graphId} onChange={(event) => setFilter('graphId', event.target.value)}><option value="">All graphs</option>{graphs.map((graph) => <option key={graph._id} value={graph._id}>{graph.name}</option>)}</select></label>
        <label>Device<input value={filters.deviceId} onChange={(event) => setFilter('deviceId', event.target.value)} placeholder="turbine-001" /></label>
        <label>From<input type="date" value={filters.from} onChange={(event) => setFilter('from', event.target.value)} /></label>
        <label>To<input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilter('to', event.target.value)} /></label>
        <label>Delivery<select value={filters.status} onChange={(event) => setFilter('status', event.target.value)}><option value="">Any status</option><option value="success">Success</option><option value="failed">Failed</option><option value="pending">Pending</option></select></label>
        <button className="text-button" onClick={() => setFilters({ graphId: '', deviceId: '', from: '', to: '', status: '' })}>Clear filters</button>
      </section>
      <div className="alerts-tabs" role="tablist" aria-label="Alert views">{[['alerts', 'Alerts', BellRing], ['deliveries', 'Deliveries', Send], ['receiver', 'Mock Receiver', Inbox]].map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}><Icon size={15} />{label}</button>)}</div>
      {error ? <div className="error-state panel" role="alert"><TriangleAlert size={24} /><h2>Could not load the audit trail</h2><p>{error}</p><button className="button button-primary" onClick={load}>Try again</button></div> : loading ? <div className="panel"><Skeleton rows={6} label="Loading alerts and deliveries" /></div> : <section className="panel alerts-table-panel" role="tabpanel">
        {tab === 'alerts' && (visibleAlerts.length ? <div className="table-scroll"><table className="audit-table"><thead><tr><th>Triggered</th><th>Device / graph</th><th>Alert</th><th>Channel</th><th>Delivery</th><th>Action</th></tr></thead><tbody>{visibleAlerts.map((alert) => { const failed = failedFor(alert); return <tr key={alert._id || `${alert.triggeredAt}-${alert.nodeId}`}><td><time>{time(alert.triggeredAt)}</time></td><td><strong>{alert.deviceId}</strong><small>{graphs.find((graph) => graph._id === alert.graphId)?.name || alert.graphId || 'Node test'}</small></td><td className="message-cell">{alert.message}<small>{alert.sensorType} · {alert.nodeId}</small></td><td>{alert.type}</td><td><StatusBadge status={alert.deliveryStatus} /></td><td>{failed ? <button className="button button-ghost retry-button" disabled={retrying.has(String(failed._id))} onClick={() => retry(String(failed._id))}><RotateCcw size={13} />{retrying.has(String(failed._id)) ? 'Retrying…' : 'Retry'}</button> : '—'}</td></tr>; })}</tbody></table></div> : <div className="empty-state"><BellRing size={30} /><h2>No matching alerts</h2><p>Activate a graph and send a spike, or clear your filters.</p></div>)}
        {tab === 'deliveries' && (deliveries.length ? <div className="table-scroll"><table className="audit-table"><thead><tr><th>Created</th><th>Channel</th><th>Target</th><th>Status</th><th>Attempts</th><th>Response</th><th>Action</th></tr></thead><tbody>{deliveries.map((delivery) => <tr key={delivery._id}><td>{time(delivery.createdAt)}</td><td>{delivery.channel}</td><td className="target-cell">{delivery.target}</td><td><StatusBadge status={delivery.status} />{delivery.error && <small className="delivery-error">{delivery.error}</small>}</td><td>{delivery.attempts} / 3 per run</td><td>{delivery.responseCode ?? '—'}</td><td>{delivery.status === 'failed' && <button className="button button-ghost retry-button" disabled={retrying.has(String(delivery._id))} onClick={() => retry(String(delivery._id))}><RotateCcw size={13} /> Retry</button>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><Send size={30} /><h2>No deliveries yet</h2><p>Test an action node or run the demo to create an audit trail.</p></div>)}
        {tab === 'receiver' && (payloads.length ? <div className="receiver-list">{payloads.map((payload) => <article className="receiver-payload" key={payload.id}><header><span><Inbox size={14} /> Payload received</span><time>{time(payload.receivedAt)}</time></header><pre>{JSON.stringify(payload.body, null, 2)}</pre><small>Headers (auth redacted): {JSON.stringify(payload.headers)}</small></article>)}</div> : <div className="empty-state"><Inbox size={30} /><h2>The mock inbox is empty</h2><p>Point a webhook at /api/mock/webhook-receiver. The inbox keeps the latest 100 payloads in memory.</p></div>)}
      </section>}
      <p className="audit-footnote">Delivery targets are masked. Manual retries share the graph rate limit and queue; double-clicks cannot claim the same failed delivery twice.</p>
    </main>
  </div>;
}
