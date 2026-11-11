import { defineConfig } from 'vitest/config';

/**
 * Vitest runs the compiler unit tests (pure logic, no database).
 * The HTTP/database suites stay on Node's built-in runner, see the "test" script.
 */
export default defineConfig({
  test: {
    include: ['test/compiler/**/*.test.js'],
    environment: 'node',
    reporters: 'default',
  },
});
