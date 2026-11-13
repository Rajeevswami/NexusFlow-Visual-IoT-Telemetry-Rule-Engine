import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LayoutTemplate, Workflow } from 'lucide-react';
import { errorMessage, graphApi } from '../../services/api.js';
import Skeleton from '../Skeleton.jsx';

export default function TemplatesMenu({ onSelect }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const root = useRef(null);
  async function load() {
    setLoading(true); setError('');
    try { setItems((await graphApi.templates()).data.data); } catch (caught) { setError(errorMessage(caught)); } finally { setLoading(false); }
  }
  useEffect(() => { if (open) load(); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="templates-menu" ref={root}>
    <button className="button button-ghost" aria-expanded={open} onClick={() => setOpen(!open)}><LayoutTemplate size={15} /> Templates <ChevronDown size={13} /></button>
    {open && <div className="templates-popover"><div className="eyebrow">START WITH A WORKING RULE</div>
      {loading ? <Skeleton rows={2} label="Loading templates" /> : error ? <div className="inline-error">{error}<button className="text-button" onClick={load}>Retry</button></div> : items.length === 0 ? <p>No templates available.</p> : items.map((item) => <button key={item.key} className="template-option" onClick={() => { onSelect(item.graph); setOpen(false); }}><Workflow size={18} /><span><strong>{item.name}</strong><small>{item.description}</small></span></button>)}
    </div>}
  </div>;
}
