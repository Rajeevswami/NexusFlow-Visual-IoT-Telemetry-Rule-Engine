import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { NODE_TYPES } from './definitions.js';
import HeadersEditor from './HeadersEditor.jsx';
import TestNodeButton from './TestNodeButton.jsx';

/**
 * Returns a setter that writes one key of `data.config` back into React Flow state.
 *
 * Uses `updateNodeData`, which merges into the node's data, so the rest of the node
 * (label, category, ...) and the other config keys are preserved.
 */
export function useNodeConfig(id, data) {
  const { updateNodeData } = useReactFlow();
  return useCallback((key, value) => {
    updateNodeData(id, { config: { ...(data?.config ?? {}), [key]: value } });
  }, [id, data?.config, updateNodeData]);
}

/**
 * A single labelled config input.
 *
 * `nodrag` / `nopan` keep React Flow from panning or starting a selection while the user
 * types or scrolls inside a node.
 */
export function ConfigField({ field, value, onChange }) {
  const inputClass = `node-input nodrag nopan ${field.type === 'select' ? 'is-select' : ''}`;
  return (
    <label className="node-field nodrag">
      <span>{field.label}</span>
      {field.type === 'select' ? (
        <select className={inputClass} value={value ?? ''} onChange={(event) => onChange(field.key, event.target.value)}>
          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea className={`${inputClass} node-textarea`} rows={4} value={value ?? ''} maxLength={field.maxLength ?? 2000} placeholder={field.placeholder} onChange={(event) => onChange(field.key, event.target.value)} />
      ) : field.type === 'number' ? (
        <input
          className={inputClass}
          type="number"
          value={value ?? ''}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(field.key, raw === '' ? '' : Number(raw));
          }}
        />
      ) : (
        <input
          className={inputClass}
          type={field.type === 'url' || field.type === 'email' ? field.type : 'text'}
          value={value ?? ''}
          placeholder={field.placeholder}
          maxLength={field.maxLength ?? (field.key === 'messageTemplate' || field.key === 'template' ? 2000 : 120)}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      )}
    </label>
  );
}

/** Renders the configured fields of a node definition. */
export function ConfigFields({ id, type, data }) {
  const definition = NODE_TYPES[type];
  const setConfig = useNodeConfig(id, data);
  if (!definition) return null;
  return (
    <div className="node-fields">
      {definition.fields.map((field) => field.type === 'headers' ? (
        <HeadersEditor key={field.key} value={data?.config?.headers ?? {}} onChange={(value) => setConfig('headers', value)} />
      ) : (
        <ConfigField key={field.key} field={field} value={data?.config?.[field.key]} onChange={setConfig} />
      ))}
      {type === 'webhook' && <small className="template-hint">Placeholders: {'{{deviceId}}'}, {'{{value}}'}, {'{{timestamp}}'}, {'{{message}}'}. Quoted values are JSON-escaped.</small>}
      {['webhook', 'smsAlert', 'email'].includes(type) && <TestNodeButton id={id} type={type} config={data?.config ?? {}} />}
    </div>
  );
}
