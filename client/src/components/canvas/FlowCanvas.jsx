import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import { MousePointer2, Sparkles } from 'lucide-react';
import { useCallback } from 'react';
import { nodeTypes } from '../nodes/index.js';
import { validateConnection } from './graphRules.js';
import AnimatedEdge from './AnimatedEdge.jsx';
import { useTheme } from '../ThemeProvider.jsx';

const edgeTypes = { glowEdge: AnimatedEdge };
const edgeOptions = { type: 'glowEdge', style: { strokeWidth: 2 } };

/**
 * Central canvas.
 *
 * `nodeTypes` comes from a module-level constant (never recreated inside a component),
 * and `isValidConnection` refuses illegal links while the user is still dragging.
 */
export default function FlowCanvas({ nodes, edges, onNodesChange, onEdgesChange, onConnect, onDrop, onInvalidConnection, canvasRef }) {
  const { theme } = useTheme();
  // Pure: React Flow calls this repeatedly while dragging, so it must not have side effects.
  const isValidConnection = useCallback(
    (connection) => validateConnection(connection, nodes, edges).valid,
    [nodes, edges],
  );

  // Report *why* a link was refused only once, when the drag ends on an invalid target.
  const handleConnectEnd = useCallback((event, connectionState) => {
    if (connectionState?.isValid !== false) return;
    const source = connectionState?.fromNode?.id;
    const target = connectionState?.toNode?.id;
    if (!source || !target) return;
    const result = validateConnection({ source, target }, nodes, edges);
    onInvalidConnection?.(result.reason ?? 'That connection is not allowed.');
  }, [nodes, edges, onInvalidConnection]);

  return (
    <div className="canvas-wrap" ref={canvasRef} onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode={theme}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={handleConnectEnd}
        isValidConnection={isValidConnection}
        defaultEdgeOptions={edgeOptions}
        connectionLineStyle={{ stroke: '#418d8a', strokeWidth: 2 }}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={2}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color={theme === 'dark' ? '#35515b' : '#cbd8d7'} />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeStrokeWidth={3}
          nodeColor={(node) => (node.data?.category === 'math' ? '#cddff6' : node.data?.category === 'action' ? '#f5ddc4' : '#bfe4db')}
          maskColor="rgba(242, 247, 246, .72)"
        />
      </ReactFlow>
      <div className="canvas-label select-none"><span className="canvas-label-icon"><Sparkles size={13} /></span><span>YOUR WORKSPACE</span><i /><span>READY TO CREATE</span></div>
      <div className="canvas-hint select-none"><MousePointer2 size={14} /> <span>Drag to pan</span><i /> <span>Scroll to zoom</span></div>
    </div>
  );
}
