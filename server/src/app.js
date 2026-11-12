import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import alertRoutes from './routes/alertRoutes.js';
import engineRoutes from './routes/engineRoutes.js';
import graphRoutes from './routes/graphRoutes.js';
import telemetryRoutes from './routes/telemetryRoutes.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.clientOrigins }));
app.use(express.json({ limit: '2mb' }));
if (env.nodeEnv !== 'test') app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/api/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'degraded',
    database: connected ? 'connected' : 'disconnected',
  });
});
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/graphs', graphRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/engine', engineRoutes);
app.use(notFound);
app.use(errorHandler);

export default app;
