/**
 * Node type registry for React Flow.
 *
 * IMPORTANT: `nodeTypes` is created once at module scope. Defining it inside a component
 * would give React Flow a new object on every render and remount every node.
 */
import FlowNode from '../canvas/FlowNode.jsx';
import LogNode from './LogNode.jsx';
import MovingAverageNode from './MovingAverageNode.jsx';
import ScaleNode from './ScaleNode.jsx';
import SensorNode from './SensorNode.jsx';
import SmsAlertNode from './SmsAlertNode.jsx';
import ThresholdNode from './ThresholdNode.jsx';
import WebhookNode from './WebhookNode.jsx';

export const nodeTypes = {
  // "nexus" is the Day 1 generic node, kept so graphs saved before Day 2 still render.
  nexus: FlowNode,
  sensor: SensorNode,
  movingAverage: MovingAverageNode,
  threshold: ThresholdNode,
  scale: ScaleNode,
  smsAlert: SmsAlertNode,
  webhook: WebhookNode,
  log: LogNode,
};

export { default as NodeCard } from './NodeCard.jsx';
export { ConfigField, ConfigFields, useNodeConfig } from './fields.jsx';
export * from './definitions.js';
