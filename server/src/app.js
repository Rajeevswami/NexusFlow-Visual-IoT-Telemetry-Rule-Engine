import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { ingestionLimiter, publicLimiter, requestId, requestLogger, requireIngestionKey } from './middleware/security.js';
import alertRoutes from './routes/alertRoutes.js';
import engineRoutes from './routes/engineRoutes.js';
import graphRoutes from './routes/graphRoutes.js';
import telemetryRoutes from './routes/telemetryRoutes.js';
import deliveryRoutes from './routes/deliveryRoutes.js';
import nodeRoutes from './routes/nodeRoutes.js';
import mockRoutes from './routes/mockRoutes.js';
import demoRoutes from './routes/demoRoutes.js';
import templateRoutes from './routes/templateRoutes.js';

const app = express();
app.disable('x-powered-by');
app.use(requestId);
app.use(requestLogger);
app.use(helmet());
app.use(cors({ origin: env.clientOrigins }));
app.use(express.json({ limit: env.requestSizeLimit }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

app.get('/api/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'degraded', database: connected ? 'connected' : 'disconnected' });
});
// POST hot path is not subject to the ordinary public API budget.
app.use('/api/telemetry', (req, res, next) => {
  if (req.method === 'POST') return ingestionLimiter(req, res, () => requireIngestionKey(req, res, next));
  return publicLimiter(req, res, next);
}, telemetryRoutes);
app.use('/api', publicLimiter);
app.use('/api/graphs', graphRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/engine', engineRoutes);
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/nodes', nodeRoutes);
app.use('/api/mock', mockRoutes);
app.use('/api/demo', demoRoutes);
app.use('/api/templates', templateRoutes);
app.use(notFound);
app.use(errorHandler);
export default app;
