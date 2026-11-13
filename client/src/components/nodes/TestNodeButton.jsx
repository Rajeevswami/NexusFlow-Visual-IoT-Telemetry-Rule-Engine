import { useState } from 'react';
import { FlaskConical, LoaderCircle } from 'lucide-react';
import { errorMessage, errorDetails, graphApi } from '../../services/api.js';
import { useToast } from '../ToastProvider.jsx';

export default function TestNodeButton({ id, type, config }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const notify = useToast();
  async function test(event) {
    event.stopPropagation(); setBusy(true); setResult(null);
    try {
      const { data } = (await graphApi.testNode({ type, config, event: { deviceId: 'turbine-001', sensorType: 'temperature', value: 82.4, unit: '°C', nodeId: id } })).data;
      setResult(data);
      notify(data.status === 'success' ? `Test ${type} delivered (${data.attempts} attempt(s)).` : data.error || 'Test delivery failed.', data.status === 'success' ? 'success' : 'error');
    } catch (error) {
      const message = errorDetails(error)[0]?.message ?? errorMessage(error);
      setResult({ status: 'failed', error: message }); notify(message, 'error');
    } finally { setBusy(false); }
  }
  return <div className="node-test nodrag nopan">
    <button type="button" className="node-test-button" onClick={test} disabled={busy}>{busy ? <LoaderCircle size={13} className="spin" /> : <FlaskConical size={13} />}{busy ? 'Testing…' : 'Test this node'}</button>
    {result && <small className={`node-test-result ${result.status}`} role="status">{result.status === 'success' ? `Success · HTTP ${result.responseCode ?? 'accepted'} · ${result.attempts} attempt(s)` : result.error}</small>}
  </div>;
}
