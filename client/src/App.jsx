import { ReactFlowProvider } from '@xyflow/react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage.jsx';
import EditorPage from './pages/EditorPage.jsx';
import { WebSocketProvider } from './ws/WebSocketProvider.jsx';

/**
 * App shell: one shared WebSocket (with auto-reconnect) for every page,
 * React Router for Editor | Dashboard navigation.
 */
export default function App() {
  return (
    <WebSocketProvider>
      <BrowserRouter>
        <ReactFlowProvider>
          <Routes>
            <Route path="/" element={<EditorPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ReactFlowProvider>
      </BrowserRouter>
    </WebSocketProvider>
  );
}
