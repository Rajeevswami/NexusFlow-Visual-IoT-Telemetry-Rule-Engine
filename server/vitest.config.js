import { defineConfig } from 'vitest/config';

/**
 * Vitest runs the compiler unit tests (pure logic, no database).
 *
 * Everything under `test/` that is not in `test/compiler` or `test/utils` is a
 * Node-test-runner suite that needs the Express app and (for the integration and
 * end-to-end suites) a real MongoDB — see the `test:http` script.
 */
export default defineConfig({
  test: {
    include: ['test/compiler/**/*.test.js', 'test/utils/**/*.test.js'],
    environment: 'node',
    reporters: 'default',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text', 'text-summary'],
      // Unit suites cover the compiler, operators, registry, executor and utilities.
      // The HTTP/DB suites (node --test) cover controllers, routes and integrations;
      // run them with `npm run test:db` for a combined picture.
      thresholds: {
        lines: 40,
        functions: 30,
        statements: 40,
        branches: 30,
      },
    },
  },
});
