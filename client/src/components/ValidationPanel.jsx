import { CheckCircle2, ChevronDown, Info, TriangleAlert, X } from 'lucide-react';

/**
 * Result panel for the "Validate graph" button.
 *
 * Errors block compilation (they mirror the backend validator); warnings are advisory.
 */
export default function ValidationPanel({ result, source, onClose, onSelectNode }) {
  if (!result) return null;
  const { errors = [], warnings = [] } = result;
  const ok = errors.length === 0;

  return (
    <section className={`validation-panel ${ok ? 'is-valid' : 'is-invalid'}`} aria-live="polite">
      <header className="validation-head">
        <span className="validation-title">
          {ok ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
          <strong>{ok ? 'Graph is valid' : `${errors.length} problem${errors.length === 1 ? '' : 's'} found`}</strong>
          {source === 'backend' && <span className="validation-source">checked by backend</span>}
          {source === 'local' && <span className="validation-source">checked in browser</span>}
        </span>
        <button className="icon-button small" onClick={onClose} aria-label="Close validation panel"><X size={15} /></button>
      </header>

      {ok && warnings.length === 0 && (
        <p className="validation-ok">Every node is connected, there are no loops and the graph has a source and an action.</p>
      )}

      {errors.length > 0 && (
        <ul className="validation-list errors">
          {errors.map((issue, index) => (
            <li key={`error-${index}`}>
              <TriangleAlert size={13} />
              <span>{issue.message}</span>
              {issue.nodeId && onSelectNode && (
                <button className="validation-link" onClick={() => onSelectNode(issue.nodeId)}>Show node</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <details className="validation-warnings" open={errors.length === 0}>
          <summary><ChevronDown size={13} /> {warnings.length} warning{warnings.length === 1 ? '' : 's'}</summary>
          <ul className="validation-list warnings">
            {warnings.map((issue, index) => (
              <li key={`warning-${index}`}>
                <Info size={13} />
                <span>{issue.message}</span>
                {issue.nodeId && onSelectNode && (
                  <button className="validation-link" onClick={() => onSelectNode(issue.nodeId)}>Show node</button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
