import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vitest runs the frontend smoke tests (jsdom + React Testing Library).
 * The plain-logic suites stay on Node's built-in runner, see the "test" script.
 */
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
    build: {
      rollupOptions: {
        output: {
          // Split the heavy, rarely-changing libraries so a code change only
          // invalidates the small app chunk instead of a single ~1 MB bundle.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            flow: ['@xyflow/react'],
            charts: ['recharts'],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.{js,jsx}'],
      exclude: ['test/**/*.node.test.js', 'node_modules/**'],
      globals: true,
      setupFiles: ['./test/setup.js'],
      restoreMocks: true,
    },
  };
});
