import { ReactFlowProvider } from '@xyflow/react';
import EditorPage from './pages/EditorPage.jsx';

export default function App() {
  return <ReactFlowProvider><EditorPage /></ReactFlowProvider>;
}
