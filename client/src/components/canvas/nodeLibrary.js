import { Activity, BellRing, ChartNoAxesCombined, Fan, Thermometer, Webhook } from 'lucide-react';

export const groups = [
  { id: 'source', label: 'Data sources', nodes: [
    { kind: 'turbine', label: 'Turbine Sensor', description: 'Stream turbine data', icon: Fan, tag: 'SENSOR INPUT', category: 'source' },
    { kind: 'temperature', label: 'Temperature Sensor', description: 'Monitor temperature', icon: Thermometer, tag: 'SENSOR INPUT', category: 'source' },
  ] },
  { id: 'math', label: 'Math operations', nodes: [
    { kind: 'average', label: 'Moving Average', description: 'Smooth out readings', icon: ChartNoAxesCombined, tag: 'TRANSFORM', category: 'math' },
    { kind: 'threshold', label: 'Threshold', description: 'Set a trigger point', icon: Activity, tag: 'CONDITION', category: 'math' },
  ] },
  { id: 'action', label: 'Action triggers', nodes: [
    { kind: 'sms', label: 'SMS Alert', description: 'Send a notification', icon: BellRing, tag: 'NOTIFICATION', category: 'action' },
    { kind: 'webhook', label: 'Webhook', description: 'Send data to a URL', icon: Webhook, tag: 'HTTP REQUEST', category: 'action' },
  ] },
];

export const nodeDefinitions = Object.fromEntries(groups.flatMap((group) => group.nodes.map((node) => [node.kind, node])));

export function makeNode(kind, position, id) {
  const definition = nodeDefinitions[kind];
  return {
    id,
    type: 'nexus',
    position,
    data: { kind, label: definition.label, category: definition.category, description: definition.description },
  };
}

export const initialNodes = [
  makeNode('turbine', { x: 0, y: 70 }, 'sample-turbine'),
  makeNode('average', { x: 300, y: 70 }, 'sample-average'),
  makeNode('sms', { x: 600, y: 70 }, 'sample-sms'),
];
export const initialEdges = [
  { id: 'sample-edge-1', source: 'sample-turbine', target: 'sample-average', type: 'smoothstep' },
  { id: 'sample-edge-2', source: 'sample-average', target: 'sample-sms', type: 'smoothstep' },
];
