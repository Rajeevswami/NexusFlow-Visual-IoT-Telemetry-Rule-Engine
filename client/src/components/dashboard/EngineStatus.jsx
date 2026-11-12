import { memo, useEffect, useState } from 'react';
import { Activity, Cpu, Gauge, Radio, Zap } from 'lucide-react';
import { engineApi, errorMessage } from '../../services/api.js';

/**
 * Engine status panel — polls GET /api/engine/status every 5 s.
 * The interval is cleared on unmount (no leaked timers).
 *
 * @param {{ status: string }} props WebSocket connection status (shown alongside)
 */
function EngineStatus({ status = 'connecting' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    let timer;
    async function poll() {
      try {
        const response = await engineApi.status();
        if (mounted) { setData(response.data.data); setError(''); }
      } catch (err) {
        if (mounted) setError(errorMessage(err));
      }
    }
    poll();
    timer = setInterval(poll, 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  const socketLabel = status === 'connected' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : 'OFFLINE';

  return (
    <section className="panel engine-status">
      <header className="panel-header">
        <span className="panel-title"><Cpu size={15} /> Engine status</span>
        <span className={`socket-badge ${status}`}><i />{socketLabel}</span>
      </header>
      {error && !data ? (
        <div className="engine-error">{error}</div>
      ) : (
        <div className="engine-grid">
          <div className="engine-cell"><Radio size={14} /><strong>{data?.activeGraphs ?? '—'}</strong><small>Active graphs</small></div>
          <div className="engine-cell"><Gauge size={14} /><strong className="tabular-nums">{data?.messagesPerSecond ?? '—'}</strong><small>Msgs / sec</small></div>
          <div className="engine-cell"><Activity size={14} /><strong className="tabular-nums">{data?.messagesProcessed?.toLocaleString() ?? '—'}</strong><small>Processed</small></div>
          <div className="engine-cell"><Zap size={14} /><strong className="tabular-nums">{data?.alertsFired ?? '—'}</strong><small>Alerts fired</small></div>
        </div>
      )}
      {data && <footer className="engine-footer">uptime {Math.floor((data.uptimeSeconds ?? 0) / 60)}m {((data.uptimeSeconds ?? 0) % 60)}s · polled every 5s</footer>}
    </section>
  );
}

export default memo(EngineStatus);
