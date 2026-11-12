import { Router } from 'express';
import { activeGraphManager } from '../services/activeGraphManager.js';
import { ruleExecutor } from '../services/ruleExecutor.js';
import { telemetryBus } from '../services/telemetryBus.js';

/** Mounted at /api/engine */
const router = Router();

/**
 * GET /api/engine/status
 * { activeGraphs, messagesProcessed, messagesPerSecond, alertsFired, ... }
 * Polled by the dashboard's EngineStatus panel every 5 s.
 */
router.get('/status', (req, res) => {
  const stats = telemetryBus.stats();
  const routing = ruleExecutor.stats();
  res.json({
    data: {
      activeGraphs: activeGraphManager.list().length,
      messagesProcessed: stats.messagesProcessed,
      messagesPerSecond: stats.messagesPerSecond,
      alertsFired: stats.alertsFired,
      routedReadings: routing.routedReadings,
      routingErrors: routing.errors,
      uptimeSeconds: Math.round(process.uptime()),
    },
  });
});

export default router;
