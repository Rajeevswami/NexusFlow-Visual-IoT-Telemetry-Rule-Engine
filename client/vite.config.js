import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const target = env.VITE_PROXY_TARGET || 'http://localhost:5000';
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      // Required for proxied cloud previews. The proxy keeps browser requests same-origin.
      allowedHosts: true,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/ws': { target, changeOrigin: true, ws: true },
      },
    },
    preview: { host: '0.0.0.0', allowedHosts: true },
  };
});
