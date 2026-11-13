import { Activity, BellRing, ChartNoAxesCombined, Mail, Radio, Scale, ScrollText, Webhook } from 'lucide-react';

/**
 * Single source of truth for every node type the editor can place on the canvas.
 *
 * `type` matches the registry key used by the backend compiler, so the palette, the
 * canvas and the stream compiler always agree on what a node is.
 *
 * Node data shape (this is what gets persisted):
 *   { id, type, position, data: { kind, label, category, description, config: { ... } } }
 */

export const CATEGORIES = {
  source: { id: 'source', label: 'Data source', color: '#2f6fb3' },
  math: { id: 'math', label: 'Math operation', color: '#b57a1a' },
  action: { id: 'action', label: 'Action trigger', color: '#b9523a' },
};

/** @type {Record<string, any>} */
export const NODE_TYPES = {
  sensor: {
    type: 'sensor',
    category: 'source',
    label: 'Sensor',
    description: 'Emits telemetry for one device + sensor type',
    tag: 'SENSOR INPUT',
    icon: Radio,
    hasInput: false,
    hasOutput: true,
    defaultConfig: { deviceId: 'turbine-001', sensorType: 'temperature' },
    fields: [
      { key: 'deviceId', label: 'Device ID', type: 'text', placeholder: 'turbine-001' },
      { key: 'sensorType', label: 'Sensor type', type: 'text', placeholder: 'temperature' },
    ],
  },
  movingAverage: {
    type: 'movingAverage',
    category: 'math',
    label: 'Moving Average',
    description: 'Smooths readings over a sliding window',
    tag: 'TRANSFORM',
    icon: ChartNoAxesCombined,
    hasInput: true,
    hasOutput: true,
    defaultConfig: { windowSize: 5 },
    fields: [
      { key: 'windowSize', label: 'Window size', type: 'number', min: 1, max: 1000, step: 1 },
    ],
  },
  threshold: {
    type: 'threshold',
    category: 'math',
    label: 'Threshold',
    description: 'Passes readings that match a comparison',
    tag: 'CONDITION',
    icon: Activity,
    hasInput: true,
    hasOutput: true,
    defaultConfig: { operator: '>', value: 80 },
    fields: [
      { key: 'operator', label: 'Operator', type: 'select', options: ['>', '>=', '<', '<=', '==', '!='] },
      { key: 'value', label: 'Value', type: 'number', step: 'any' },
    ],
  },
  scale: {
    type: 'scale',
    category: 'math',
    label: 'Scale',
    description: 'Applies value * factor + offset',
    tag: 'TRANSFORM',
    icon: Scale,
    hasInput: true,
    hasOutput: true,
    defaultConfig: { factor: 1, offset: 0 },
    fields: [
      { key: 'factor', label: 'Factor', type: 'number', step: 'any' },
      { key: 'offset', label: 'Offset', type: 'number', step: 'any' },
    ],
  },
  smsAlert: {
    type: 'smsAlert',
    category: 'action',
    label: 'SMS Alert',
    description: 'Sends a mock SMS and stores an alert',
    tag: 'NOTIFICATION',
    icon: BellRing,
    hasInput: true,
    hasOutput: false,
    defaultConfig: { phone: '+911234567890', messageTemplate: 'ALERT ${deviceId} ${sensorType} = ${value}${unit}', cooldownSeconds: 0 },
    fields: [
      { key: 'phone', label: 'Phone', type: 'text', placeholder: '+911234567890' },
      { key: 'messageTemplate', label: 'Message', type: 'text', placeholder: 'ALERT ${deviceId} = ${value}${unit}' },
      { key: 'cooldownSeconds', label: 'Cooldown (s)', type: 'number', min: 0, max: 86400, step: 1 },
    ],
  },
  webhook: {
    type: 'webhook',
    category: 'action',
    label: 'Webhook',
    description: 'Calls an HTTP endpoint with retries and delivery tracking',
    tag: 'HTTP REQUEST',
    icon: Webhook,
    hasInput: true,
    hasOutput: false,
    defaultConfig: { url: 'https://example.com/hook', method: 'POST', headers: {}, bodyTemplate: '{"deviceId":"{{deviceId}}","value":{{value}},"timestamp":"{{timestamp}}","message":"{{message}}"}', cooldownSeconds: 30 },
    fields: [
      { key: 'url', label: 'URL', type: 'url', placeholder: 'https://example.com/hook', maxLength: 2048 },
      { key: 'method', label: 'Method', type: 'select', options: ['POST', 'GET', 'PUT', 'PATCH'] },
      { key: 'headers', label: 'Headers', type: 'headers' },
      { key: 'bodyTemplate', label: 'JSON body template', type: 'textarea', maxLength: 16384, placeholder: '{"value":{{value}}}' },
      { key: 'cooldownSeconds', label: 'Cooldown (s)', type: 'number', min: 0, max: 86400, step: 1 },
    ],
  },
  email: {
    type: 'email', category: 'action', label: 'Email', description: 'Mock email or SMTP with a delivery audit', tag: 'NOTIFICATION', icon: Mail,
    hasInput: true, hasOutput: false,
    defaultConfig: { to: 'operator@example.com', subject: 'NexusFlow alert: ${deviceId}', messageTemplate: 'ALERT {{deviceId}} {{sensorType}} = {{value}}{{unit}}', cooldownSeconds: 30 },
    fields: [
      { key: 'to', label: 'Recipient', type: 'email', placeholder: 'operator@example.com', maxLength: 254 },
      { key: 'subject', label: 'Subject', type: 'text', maxLength: 200 },
      { key: 'messageTemplate', label: 'Message', type: 'textarea', maxLength: 2000 },
      { key: 'cooldownSeconds', label: 'Cooldown (s)', type: 'number', min: 0, max: 86400, step: 1 },
    ],
  },
  log: {
    type: 'log',
    category: 'action',
    label: 'Log',
    description: 'Prints the reading to the server console',
    tag: 'DEBUG OUTPUT',
    icon: ScrollText,
    hasInput: true,
    hasOutput: false,
    defaultConfig: { label: 'pipeline', template: '${deviceId} ${sensorType} = ${value}${unit}', cooldownSeconds: 0 },
    fields: [
      { key: 'label', label: 'Prefix', type: 'text', placeholder: 'pipeline' },
      { key: 'template', label: 'Template', type: 'text', placeholder: '${deviceId} = ${value}${unit}' },
      { key: 'cooldownSeconds', label: 'Cooldown (s)', type: 'number', min: 0, max: 86400, step: 1 },
    ],
  },
};

/**
 * Palette groups. Several entries can share the same `type` with different starting
 * config (Turbine Sensor and Temperature Sensor are both `sensor` nodes).
 */
export const PALETTE_GROUPS = [
  {
    id: 'source',
    label: 'Data sources',
    items: [
      { type: 'sensor', label: 'Turbine Sensor', description: 'Turbine temperature stream', config: { deviceId: 'turbine-001', sensorType: 'temperature' } },
      { type: 'sensor', label: 'Temperature Sensor', description: 'Ambient temperature stream', config: { deviceId: 'temp-001', sensorType: 'temperature' } },
      { type: 'sensor', label: 'Vibration Sensor', description: 'Turbine vibration stream', config: { deviceId: 'turbine-001', sensorType: 'vibration' } },
    ],
  },
  {
    id: 'math',
    label: 'Math operations',
    items: [
      { type: 'movingAverage', label: 'Moving Average', description: 'Smooth over N readings', config: { windowSize: 5 } },
      { type: 'threshold', label: 'Threshold', description: 'Filter by comparison', config: { operator: '>', value: 80 } },
      { type: 'scale', label: 'Scale', description: 'Convert or calibrate values', config: { factor: 1, offset: 0 } },
    ],
  },
  {
    id: 'action',
    label: 'Action triggers',
    items: [
      { type: 'smsAlert', label: 'SMS Alert', description: 'Notify an operator', config: { phone: '+911234567890' } },
      { type: 'webhook', label: 'Webhook', description: 'Call an HTTP endpoint', config: { url: 'https://example.com/hook', method: 'POST' } },
      { type: 'email', label: 'Email', description: 'Notify by mock email or SMTP', config: { to: 'operator@example.com' } },
      { type: 'log', label: 'Log', description: 'Debug the pipeline', config: { label: 'pipeline' } },
    ],
  },
];

export const getDefinition = (type) => NODE_TYPES[type] ?? null;
export const NODE_TYPE_KEYS = Object.keys(NODE_TYPES);

let counter = 0;
export function nextNodeId(type) {
  counter += 1;
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 6) ?? `${Date.now().toString(36)}${counter}`;
  return `${type}-${suffix}`;
}

/**
 * Build a React Flow node with a fully populated `data` object.
 *
 * @param {string} type registry key, e.g. "movingAverage"
 * @param {{x: number, y: number}} position
 * @param {string} [id]
 * @param {object} [config] overrides for the node defaults
 */
export function makeNode(type, position, id = nextNodeId(type), config = {}) {
  const definition = getDefinition(type);
  if (!definition) throw new Error(`Unknown node type "${type}"`);
  return {
    id,
    type,
    position,
    data: {
      kind: type,
      label: definition.label,
      category: definition.category,
      description: definition.description,
      config: { ...definition.defaultConfig, ...config },
    },
  };
}

/** Day-2 seed graph: Turbine Sensor -> Moving Average -> Threshold -> SMS Alert. */
export const initialNodes = [
  makeNode('sensor', { x: 0, y: 96 }, 'sensor-turbine', { deviceId: 'turbine-001', sensorType: 'temperature' }),
  makeNode('movingAverage', { x: 320, y: 96 }, 'average-1', { windowSize: 5 }),
  makeNode('threshold', { x: 640, y: 96 }, 'threshold-1', { operator: '>', value: 80 }),
  makeNode('smsAlert', { x: 960, y: 96 }, 'sms-1', { phone: '+911234567890' }),
];

export const initialEdges = [
  { id: 'edge-sensor-average', source: 'sensor-turbine', target: 'average-1', type: 'smoothstep' },
  { id: 'edge-average-threshold', source: 'average-1', target: 'threshold-1', type: 'smoothstep' },
  { id: 'edge-threshold-sms', source: 'threshold-1', target: 'sms-1', type: 'smoothstep' },
];
