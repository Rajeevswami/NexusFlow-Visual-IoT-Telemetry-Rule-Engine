import http from 'node:http';
import mongoose from 'mongoose';
import app from './app.js';
import { connectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { attachWebSocketServer } from './services/websocket.js';
import { activeGraphManager } from './services/activeGraphManager.js';
import { ruleExecutor } from './services/ruleExecutor.js';
import { shutdownDeliveries } from './services/deliveryService.js';
import { stopDemo } from './services/demoService.js';

let server;
let sockets;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  const forceExit = setTimeout(() => { logger.fatal('Graceful shutdown timed out'); process.exit(1); }, 10_000);
  forceExit.unref();
  try {
    await stopDemo();
    ruleExecutor.stop();
    activeGraphManager.disposeAll();
    server?.closeIdleConnections?.();
    if (sockets) {
      for (const client of sockets.clients) client.terminate();
      await new Promise((resolve) => sockets.close(resolve));
    }
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await shutdownDeliveries();
    await mongoose.disconnect();
    logger.info('Shutdown complete');
  } finally { clearTimeout(forceExit); }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown(signal).then(() => process.exit(0)).catch((error) => { logger.fatal({ err: error }, 'Shutdown failed'); process.exit(1); });
  });
}

// Never let a stray rejection take the process down silently: log it with a request id
// so it can be traced. An uncaught exception leaves the process in an unknown state, so
// it is logged and then exits non-zero (the platform/container restarts it).
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception; exiting');
  shutdown('uncaught exception')
    .catch(() => {})
    .finally(() => process.exit(1));
});

try {
  await connectDatabase();
  server = http.createServer(app);
  sockets = attachWebSocketServer(server);
  ruleExecutor.start();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.port, '0.0.0.0', resolve);
  });
  logger.info({ port: env.port, websocket: '/ws' }, 'NexusFlow API listening');

  // Re-hydration: recompile every graph that was running before the restart so a
  // deploy, crash or free-tier sleep does not silently stop the rules. Failures are
  // per-graph and never block the listening server.
  activeGraphManager.hydrateActiveGraphs()
    .then((summary) => {
      if (summary.total > 0) {
        logger.info({ ...summary }, 'Active graph re-hydration complete');
      }
    })
    .catch((error) => logger.error({ err: error }, 'Active graph re-hydration failed'));
} catch (error) {
  logger.fatal({ err: error }, 'Startup failed');
  await shutdown('startup failure').catch((shutdownError) => {
    logger.fatal({ err: shutdownError }, 'Shutdown after startup failure failed');
  });
  process.exitCode = 1;
}
