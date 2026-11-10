import { ArrowRight, FolderOpen, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

export default function GraphPicker({ graphs, loading, error, busyId, onSelect, onRetry, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const controls = [...(dialogRef.current?.querySelectorAll('button:not([disabled])') || [])];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="load-title">
        <div className="modal-heading"><div><span className="eyebrow">YOUR SAVED WORK</span><h2 id="load-title">Load a graph<span className="heading-period">.</span></h2><p>Pick up right where you left off.</p></div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
        <div className="modal-content">
          {loading && <div className="modal-state"><LoaderCircle className="spin" size={21} /><span>Finding your graphs...</span></div>}
          {!loading && error && <div className="modal-state"><span>{error}</span><button className="button button-secondary" onClick={onRetry}><RefreshCw size={14} /> Try again</button></div>}
          {!loading && !error && graphs.length === 0 && <div className="modal-state"><FolderOpen size={25} /><strong>No saved graphs yet</strong><span>Save your first flow and it will appear here.</span></div>}
          {!loading && !error && graphs.map((graph) => <button className="graph-option" key={graph._id} onClick={() => onSelect(graph._id)} disabled={Boolean(busyId)}>
            <span className="graph-option-icon"><FolderOpen size={18} /></span><span className="graph-option-copy"><strong>{graph.name}</strong><small>Updated {new Date(graph.updatedAt).toLocaleString()}</small></span>
            {busyId === graph._id ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
          </button>)}
        </div>
        <div className="modal-footer">Loading a graph replaces the current canvas.</div>
      </div>
    </div>
  );
}
