import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { deliverWebhook, buildWebhookRequest, validateWebhookConfig } from '../../src/integrations/webhookService.js';
import { resolveWebhookUrl, isPrivateAddress } from '../../src/integrations/urlSafety.js';
import { renderJsonTemplate } from '../../src/integrations/template.js';

const request = { url: 'https://hooks.example.com/alert', method: 'POST', headers: { Authorization: 'Bearer secret' }, body: { value: 90 } };
const resolved = { url: request.url, httpAgent: { destroy() {} }, httpsAgent: { destroy() {} } };
const resolveUrl = vi.fn(async () => resolved);
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('JSON templates', () => {
  it('renders both quoted and bare placeholders without breaking JSON', () => {
    const event = { deviceId: 'turbine-"01"', value: 82.4, timestamp: '2026-01-01T00:00:00Z', message: 'hot' };
    expect(renderJsonTemplate('{"device":"{{deviceId}}","value":{{value}},"at":"{{timestamp}}","message":"{{message}}"}', event))
      .toEqual({ device: 'turbine-"01"', value: 82.4, at: '2026-01-01T00:00:00.000Z', message: 'hot' });
  });
  it('rejects malformed JSON and unknown placeholders', () => {
    expect(() => renderJsonTemplate('{bad}')).toThrow(/JSON object/);
    expect(() => renderJsonTemplate('{{secret}}')).toThrow(/Unknown/);
    expect(validateWebhookConfig({ url: request.url, bodyTemplate: '{bad}' })).toHaveLength(1);
  });
  it('builds GET requests and preserves custom headers', () => {
    const built = buildWebhookRequest({ url: request.url, method: 'GET', headers: { 'X-Test': 'yes' } }, { value: 1 });
    expect(built.method).toBe('GET');
    expect(built.headers['X-Test']).toBe('yes');
  });
});

describe('SSRF safety', () => {
  it.each(['http://localhost/x', 'http://127.0.0.1', 'http://10.1.2.3', 'http://172.16.0.1', 'http://172.31.255.255', 'http://192.168.1.1', 'http://169.254.169.254/latest', 'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://[fc00::1]', 'file:///etc/passwd', 'ftp://example.com'])('blocks %s', async (url) => {
    await expect(resolveWebhookUrl(url, { allowPrivate: false })).rejects.toThrow(/blocked|http or https/);
  });
  it('blocks a hostname if any DNS answer is private (mixed DNS)', async () => {
    await expect(resolveWebhookUrl('https://mixed.example.com', { allowPrivate: false,
      lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }] })).rejects.toThrow(/blocked/);
  });
  it('allows public addresses and the explicit local-testing override', async () => {
    const answer = await resolveWebhookUrl('https://public.example.com', { allowPrivate: false, lookup: async () => [{ address: '93.184.216.34', family: 4 }] });
    expect(answer.addresses[0].address).toBe('93.184.216.34');
    answer.httpAgent.destroy(); answer.httpsAgent.destroy();
    const local = await resolveWebhookUrl('http://127.0.0.1:5000', { allowPrivate: true });
    expect(local.addresses[0].address).toBe('127.0.0.1');
    local.httpAgent.destroy(); local.httpsAgent.destroy();
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
  });
  it('rejects embedded credentials and header injection', () => {
    expect(validateWebhookConfig({ url: 'https://user:pass@example.com' })).toHaveLength(1);
    expect(validateWebhookConfig({ url: request.url, headers: { 'X-Test': 'a\r\nInjected: yes' } })).toHaveLength(1);
  });
});

describe('webhook retries', () => {
  it('retries a 5xx then succeeds', async () => {
    const mock = vi.spyOn(axios, 'request').mockResolvedValueOnce({ status: 503 }).mockResolvedValueOnce({ status: 204 });
    const result = await deliverWebhook(request, { retryBaseMs: 0, resolveUrl });
    expect(result).toEqual({ status: 'success', attempts: 2, responseCode: 204, error: null });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[0][0].timeout).toBe(5000);
    expect(mock.mock.calls[0][0].maxRedirects).toBe(0);
  });
  it('retries network errors at most three total attempts', async () => {
    const mock = vi.spyOn(axios, 'request').mockRejectedValue(Object.assign(new Error('secret URL leaked'), { code: 'ECONNRESET' }));
    const result = await deliverWebhook(request, { retryBaseMs: 0, resolveUrl });
    expect(result.status).toBe('failed'); expect(result.attempts).toBe(3);
    expect(result.error).not.toContain('secret'); expect(mock).toHaveBeenCalledTimes(3);
  });
  it.each([400, 429, 302])('does not retry HTTP %s', async (status) => {
    const mock = vi.spyOn(axios, 'request').mockResolvedValue({ status });
    const result = await deliverWebhook(request, { retryBaseMs: 0, resolveUrl });
    expect(result.attempts).toBe(1); expect(result.status).toBe('failed'); expect(mock).toHaveBeenCalledTimes(1);
  });
  it('uses exponential 250/500 ms backoff', async () => {
    vi.useFakeTimers();
    const mock = vi.spyOn(axios, 'request').mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));
    const pending = deliverWebhook(request, { retryBaseMs: 250, resolveUrl });
    await vi.advanceTimersByTimeAsync(0); expect(mock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(249); expect(mock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(mock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(499); expect(mock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(mock).toHaveBeenCalledTimes(3);
    expect((await pending).attempts).toBe(3);
  });
  it('does not send GET bodies', async () => {
    const mock = vi.spyOn(axios, 'request').mockResolvedValue({ status: 200 });
    await deliverWebhook({ ...request, method: 'GET' }, { resolveUrl });
    expect(mock.mock.calls[0][0].data).toBeUndefined();
  });
});
