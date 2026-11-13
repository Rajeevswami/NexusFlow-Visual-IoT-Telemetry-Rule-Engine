import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { maskEmail } from '../utils/sanitize.js';
import { DeliveryError } from './urlSafety.js';

export class MockEmailProvider {
  constructor() { this.messages = []; this.name = 'mock'; }
  async send({ to, subject, body }) {
    this.messages.push({ to: maskEmail(to), subject, body, receivedAt: new Date().toISOString() });
    if (this.messages.length > 200) this.messages.shift();
    logger.info({ channel: 'email', provider: 'mock', target: maskEmail(to) }, 'Mock email delivered');
    return { responseCode: 250 };
  }
}
export class NodemailerProvider {
  constructor(config = env.smtp) { this.config = config; this.name = 'smtp'; }
  async send({ to, subject, body }) {
    // Lazy load: mock-only installations never open an SMTP transport.
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: this.config.host, port: this.config.port, secure: this.config.secure,
      auth: this.config.user ? { user: this.config.user, pass: this.config.pass } : undefined,
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000,
    });
    try {
      await transport.sendMail({ from: this.config.from, to, subject, text: body });
      return { responseCode: 250 };
    } catch (error) {
      throw new DeliveryError('Email provider request failed.', { responseCode: Number(error.responseCode) || null, retryable: ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS'].includes(error.code) || error.responseCode >= 500 });
    } finally { transport.close(); }
  }
}
export const mockEmailProvider = new MockEmailProvider();
export function createEmailProvider(name = env.emailProvider) { return name === 'smtp' ? new NodemailerProvider() : mockEmailProvider; }
export function sendEmail(payload, provider = createEmailProvider()) { return provider.send(payload); }
