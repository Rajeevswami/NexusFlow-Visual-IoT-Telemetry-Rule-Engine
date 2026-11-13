import { Router } from 'express';
import { listReceived, receiveWebhook } from '../services/mockReceiver.js';
import { env } from '../config/env.js';
import { httpError } from '../utils/httpError.js';
const router = Router();
router.use((req, res, next) => env.mockReceiverEnabled ? next() : next(httpError(404, 'Mock receiver is disabled.')));
router.post('/webhook-receiver', (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw httpError(400, 'Receiver expects a JSON object.');
  res.status(201).json({ data: receiveWebhook(req.body, req.headers) });
});
router.get('/webhook-receiver', (req, res) => res.json({ data: listReceived(Number(req.query.limit) || 50) }));
export default router;
