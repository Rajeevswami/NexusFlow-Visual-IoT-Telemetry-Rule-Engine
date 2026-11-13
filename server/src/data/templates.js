import { env } from '../config/env.js';

const node = (id, type, label, x, y, config) => ({ id, type, position: { x, y }, data: { kind: type, label, config } });
const edge = (id, source, target) => ({ id, source, target });
const webhookConfig = () => ({
  url: env.demoWebhookUrl, method: 'POST', headers: { 'X-Source': 'NexusFlow' },
  bodyTemplate: '{\n  "device": "{{deviceId}}",\n  "sensor": "{{sensorType}}",\n  "value": {{value}},\n  "timestamp": "{{timestamp}}",\n  "message": "{{message}}"\n}',
  cooldownSeconds: 10,
});

/** Plain React Flow JSON: shared by the seed, template API and one-click demo. */
export function getTemplates() {
  return [
    {
      key: 'turbine-overheat', name: 'Turbine Overheat Alert',
      description: 'A 3-sample temperature average above 80 °C notifies an operator and calls a webhook.',
      graph: {
        name: 'Turbine Overheat Alert', templateKey: 'turbine-overheat',
        nodes: [
          node('sensor-turbine', 'sensor', 'Turbine temperature', 0, 180, { deviceId: 'turbine-001', sensorType: 'temperature' }),
          node('average-1', 'movingAverage', 'Moving average', 310, 180, { windowSize: 3 }),
          node('threshold-1', 'threshold', 'Overheat > 80 °C', 620, 180, { operator: '>', value: 80 }),
          node('webhook-1', 'webhook', 'Maintenance webhook', 930, 0, webhookConfig()),
          node('sms-1', 'smsAlert', 'Operator SMS', 930, 440, { phone: '+911234567890', messageTemplate: 'ALERT {{deviceId}} average = {{value}}{{unit}}', cooldownSeconds: 10 }),
        ],
        edges: [edge('e-sensor-average', 'sensor-turbine', 'average-1'), edge('e-average-threshold', 'average-1', 'threshold-1'),
          edge('e-threshold-webhook', 'threshold-1', 'webhook-1'), edge('e-threshold-sms', 'threshold-1', 'sms-1')],
      },
    },
    {
      key: 'vibration-anomaly', name: 'Vibration Anomaly Webhook',
      description: 'A 4-sample vibration average above 4 mm/s calls an HTTP integration.',
      graph: {
        name: 'Vibration Anomaly Webhook', templateKey: 'vibration-anomaly',
        nodes: [
          node('sensor-vibration', 'sensor', 'Turbine vibration', 0, 100, { deviceId: 'turbine-001', sensorType: 'vibration' }),
          node('average-vibration', 'movingAverage', 'Smooth vibration', 320, 100, { windowSize: 4 }),
          node('threshold-vibration', 'threshold', 'Anomaly > 4 mm/s', 640, 100, { operator: '>', value: 4 }),
          node('webhook-vibration', 'webhook', 'Anomaly webhook', 960, 100, { ...webhookConfig(), cooldownSeconds: 15 }),
        ],
        edges: [edge('e-vibration-average', 'sensor-vibration', 'average-vibration'), edge('e-vibration-threshold', 'average-vibration', 'threshold-vibration'), edge('e-vibration-webhook', 'threshold-vibration', 'webhook-vibration')],
      },
    },
  ];
}
