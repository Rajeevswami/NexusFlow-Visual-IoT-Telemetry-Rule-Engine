import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 8000,
});

export const graphApi = {
  health: () => api.get('/health'),
  create: (graph) => api.post('/graphs', graph),
  list: () => api.get('/graphs'),
  get: (id) => api.get(`/graphs/${encodeURIComponent(id)}`),
  update: (id, graph) => api.put(`/graphs/${encodeURIComponent(id)}`, graph),
  templates: () => api.get('/templates'),
  testNode: (payload) => api.post('/nodes/test', payload, { timeout: 25_000 }),
  /** Validate raw graph JSON server-side without saving it. */
  validate: (graph) => api.post('/graphs/validate', graph),
  /** Compile + activate a saved graph (returns the pipeline summary). */
  compile: (id) => api.post(`/graphs/${encodeURIComponent(id)}/compile`),
  deactivate: (id) => api.post(`/graphs/${encodeURIComponent(id)}/deactivate`),
  active: () => api.get('/graphs/active'),
  /** Dry run: push sample values through the compiled pipeline. */
  test: (id, values) => api.post(`/graphs/${encodeURIComponent(id)}/test`, { values }),
};

export const telemetryApi = {
  /** Recent alerts: `?graphId=&deviceId=&limit=` */
  alerts: (params = {}) => api.get('/alerts', { params }),
  /** Per-minute buckets: `?deviceId=&window=5m` (avg/min/max/count). */
  stats: (params = {}) => api.get('/telemetry/stats', { params }),
  /** Ingest readings (the "Send Test Data" button and manual curl tests). */
  ingestBatch: (readings) => api.post('/telemetry/batch', readings),
  readings: (params = {}) => api.get('/telemetry', { params }),
};

export const deliveryApi = {
  list: (params = {}) => api.get('/deliveries', { params }),
  retry: (id) => api.post(`/deliveries/${encodeURIComponent(id)}/retry`),
  receiver: () => api.get('/mock/webhook-receiver'),
};
export const demoApi = {
  start: () => api.post('/demo/start', { durationSeconds: 120 }, { timeout: 20_000 }),
  stop: () => api.post('/demo/stop'),
  status: () => api.get('/demo/status'),
};

export const engineApi = {
  /** { activeGraphs, messagesProcessed, messagesPerSecond, alertsFired } */
  status: () => api.get('/engine/status'),
};

export function errorMessage(error) {
  return error.response?.data?.error?.message
    || (error.code === 'ECONNABORTED' ? 'The request timed out.' : null)
    || error.message
    || 'Cannot reach the backend. Check that the server and MongoDB are running.';
}

/** Backend validation issues, when the API returned a 400 with details. */
export function errorDetails(error) {
  return Array.isArray(error.response?.data?.error?.details) ? error.response.data.error.details : [];
}
