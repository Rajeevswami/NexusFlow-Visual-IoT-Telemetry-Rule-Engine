import axios from 'axios';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { maskPhone } from '../utils/sanitize.js';
import { DeliveryError } from './urlSafety.js';

/** Provider contract: send({ to, body, signal }) -> { responseCode, messageId }. */
export class MockSmsProvider {
  constructor() { this.messages = []; this.name = 'mock'; }
  async send({ to, body }) {
    const message = { to: maskPhone(to), body, receivedAt: new Date().toISOString() };
    this.messages.push(message);
    if (this.messages.length > 200) this.messages.shift();
    logger.info({ channel: 'sms', provider: 'mock', target: message.to, body }, 'Mock SMS delivered');
    return { responseCode: 202, messageId: `mock-sms-${this.messages.length}` };
  }
}
export class TwilioProvider {
  constructor(config = env.twilio) { this.config = config; this.name = 'twilio'; }
  async send({ to, body, signal }) {
    try {
      const response = await axios.request({
        url: `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`,
        method: 'POST', auth: { username: this.config.accountSid, password: this.config.authToken },
        data: new URLSearchParams({ To: to, From: this.config.from, Body: body }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 5000, signal, proxy: false, maxRedirects: 0, maxContentLength: 65536,
        validateStatus: () => true,
      });
      if (response.status < 200 || response.status >= 300) throw new DeliveryError(`SMS provider returned HTTP ${response.status}.`, { responseCode: response.status, retryable: response.status >= 500 });
      return { responseCode: response.status, messageId: response.data?.sid };
    } catch (error) {
      if (error instanceof DeliveryError) throw error;
      throw new DeliveryError('SMS provider network request failed.', { retryable: true });
    }
  }
}
export const mockSmsProvider = new MockSmsProvider();
export function createSmsProvider(name = env.smsProvider) { return name === 'twilio' ? new TwilioProvider() : mockSmsProvider; }
export async function sendSms(payload, provider = createSmsProvider()) {
  if (!/^\+[1-9]\d{6,14}$/.test(payload.to)) throw new DeliveryError('SMS phone must use E.164 format, for example +919876543210.');
  return provider.send(payload);
}
