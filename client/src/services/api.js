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
};

export function errorMessage(error) {
  return error.response?.data?.error?.message || (error.code === 'ECONNABORTED' ? 'The request timed out.' : 'Cannot reach the backend. Check that the server and MongoDB are running.');
}
