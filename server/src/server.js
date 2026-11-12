import http from 'node:http';
import mongoose from 'mongoose';
import app from './app.js';
import { connectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { attachWebSocketServer } from './services/websocket.js';
import { activeGraphManager } from './services/activeGraphManager.js';
import { ruleExecutor } from './services/ruleExecutor.js';

let server;
let sockets;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`${signal}: shutting down`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  if (sockets) {
    for (const client of sockets.clients) client.terminate();
    sockets.close();
  }
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  // Release every compiled pipeline and detach the rule engine before the process exits.
  activeGraphManager.disposeAll();
  ruleExecutor.stop();
  await mongoose.disconnect();
  clearTimeout(forceExit);
}

process.on('SIGINT', () => { shutdown('SIGINT').catch(console.error); });
process.on('SIGTERM', () => { shutdown('SIGTERM').catch(console.error); });

try {
  await connectDatabase();
  server = http.createServer(app);
  sockets = attachWebSocketServer(server);
  // Attach the rule engine to the telemetry bus before the first reading arrives.
  ruleExecutor.start();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.port, '0.0.0.0', resolve);
  });
  console.info(`NexusFlow API listening on port ${env.port}; WebSocket: /ws`);
} catch (error) {
  console.error('Startup failed:', error.message);
  await shutdown('startup failure');
  process.exitCode = 1;
}
