import { memo } from 'react';
import { BellRing, Info, TriangleAlert } from 'lucide-react';

const SEVERITY = {
  critical: { className: 'severity-critical', Icon: TriangleAlert },
  warning: { className: 'severity-warning', Icon: TriangleAlert },
  info: { className: 'severity-info', Icon: Info },
};

const formatTime = (value) => {
  const d = new Date(value);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/**
 * Live alert list — newest first, severity colour + relative time.
 * Fed by `useChannel('alerts', ...)` in the parent so it re-renders only when an
 * alert actually arrives (alerts are low-volume by design).
 *
 * @param {{ alerts: object[] }} props
 */
function AlertFeed({ alerts }) {
  return (
    <section className="panel alert-feed">
      <header className="panel-header">
        <span className="panel-title"><BellRing size={15} /> Alert feed</span>
        <span className="panel-meta">{alerts.length} recent</span>
      </header>
      {alerts.length === 0 ? (
        <div className="alert-empty">
          <strong>No alerts yet</strong>
          <p>Activate a graph and run the simulator — fired rules show up here instantly.</p>
        </div>
      ) : (
        <ul className="alert-list">
          {alerts.map((alert, index) => {
            const severity = SEVERITY[alert.severity] ?? SEVERITY.info;
            const { Icon } = severity;
            return (
              <li key={`${alert.triggeredAt}-${alert.nodeId}-${index}`} className={`alert-row ${severity.className}`}>
                <span className="alert-severity-icon"><Icon size={14} /></span>
                <span className="alert-copy">
                  <strong>{alert.deviceId}{alert.sensorType ? ` · ${alert.sensorType}` : ''}</strong>
                  <small>{alert.message}</small>
                </span>
                <span className="alert-meta">
                  <em>{alert.severity ?? 'info'}</em>
                  <time dateTime={alert.triggeredAt}>{formatTime(alert.triggeredAt)}</time>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default memo(AlertFeed);
