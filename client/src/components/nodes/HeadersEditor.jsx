import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';

export default function HeadersEditor({ value, onChange }) {
  const [rows, setRows] = useState(() => Object.entries(value ?? {}).map(([key, value]) => ({ key, value })));
  const last = useRef(JSON.stringify(value ?? {}));
  useEffect(() => {
    const signature = JSON.stringify(value ?? {});
    if (signature !== last.current) { last.current = signature; setRows(Object.entries(value ?? {}).map(([key, value]) => ({ key, value }))); }
  }, [value]);
  function commit(next) {
    setRows(next);
    const object = Object.fromEntries(next.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]));
    last.current = JSON.stringify(object); onChange(object);
  }
  const update = (index, patch) => commit(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <fieldset className="headers-editor nodrag nopan"><legend>Custom headers</legend>
    {rows.map((row, index) => <div className="header-row" key={index}>
      <input className="node-input" aria-label={`Header ${index + 1} name`} placeholder="X-Api-Key" value={row.key} maxLength={80} onChange={(event) => update(index, { key: event.target.value })} />
      <input className="node-input" aria-label={`Header ${index + 1} value`} placeholder="value" value={row.value} maxLength={2048} onChange={(event) => update(index, { value: event.target.value })} />
      <button type="button" aria-label={`Remove header ${index + 1}`} onClick={() => commit(rows.filter((_, i) => i !== index))}><X size={13} /></button>
    </div>)}
    <button type="button" className="text-button" onClick={() => setRows([...rows, { key: '', value: '' }])}><Plus size={12} /> Add header</button>
    <small>Auth header values are redacted in logs and delivery responses.</small>
  </fieldset>;
}
