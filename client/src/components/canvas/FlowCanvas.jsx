import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import { MousePointer2, Sparkles } from 'lucide-react';
import FlowNode from './FlowNode.jsx';

const nodeTypes = { nexus: FlowNode };
const edgeOptions = { type: 'smoothstep', style: { stroke: '#94aaa9', strokeWidth: 2 } };

export default function FlowCanvas({ nodes, edges, onNodesChange, onEdgesChange, onConnect, onDrop, canvasRef }) {
  return (
    <div className="canvas-wrap" ref={canvasRef} onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange} onConnect={onConnect} defaultEdgeOptions={edgeOptions}
        connectionLineStyle={{ stroke: '#418d8a', strokeWidth: 2 }}
        isValidConnection={(connection) => connection.source !== connection.target}
        fitView fitViewOptions={{ padding: 0.24, maxZoom: 1 }} minZoom={0.25} maxZoom={2}
        deleteKeyCode={['Backspace', 'Delete']} proOptions={{ hideAttribution: false }}>
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="#cbd8d7" />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap position="bottom-right" pannable zoomable nodeStrokeWidth={3}
          nodeColor={(node) => node.data.category === 'math' ? '#cddff6' : node.data.category === 'action' ? '#f5ddc4' : '#bfe4db'}
          maskColor="rgba(242, 247, 246, .72)" />
      </ReactFlow>
      <div className="canvas-label select-none"><span className="canvas-label-icon"><Sparkles size={13} /></span><span>YOUR WORKSPACE</span><i /><span>READY TO CREATE</span></div>
      <div className="canvas-hint select-none"><MousePointer2 size={14} /> <span>Drag to pan</span><i /> <span>Scroll to zoom</span></div>
    </div>
  );
}
