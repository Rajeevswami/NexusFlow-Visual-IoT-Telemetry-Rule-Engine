import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const files = [
  'test/validation.test.js',
  'test/integration.test.js',
  'test/apiIntegration.test.js',
  'test/compilerRoutes.test.js',
  'test/websocketChannels.test.js',
  'test/websocketActivity.test.js',
  'test/security.test.js',
  'test/day4Integration.test.js',
  'test/e2e.test.js',
];
let memory;
let uri = process.env.TEST_MONGODB_URI;
try {
  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    // Downloads a MongoDB binary on first use (internet required), never touches your data.
    memory = await MongoMemoryServer.create({ binary: { version: '8.0.4' } });
    uri = memory.getUri();
  }
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', '--import', './test/testEnv.js', ...files], {
      cwd, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', TEST_MONGODB_URI: uri },
    });
    child.on('error', reject); child.on('exit', (exitCode) => resolve(exitCode ?? 1));
  });
  process.exitCode = code;
} catch (error) {
  console.error(`Database test setup failed: ${error.message}`);
  console.error('Use TEST_MONGODB_URI with an existing MongoDB 5+ server, or allow the first mongodb-memory-server binary download.');
  process.exitCode = 1;
} finally { await memory?.stop(); }
