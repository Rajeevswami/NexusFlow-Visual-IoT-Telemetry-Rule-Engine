import { ReactFlowProvider } from '@xyflow/react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage.jsx';
import EditorPage from './pages/EditorPage.jsx';
import AlertsPage from './pages/AlertsPage.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { ThemeProvider } from './components/ThemeProvider.jsx';
import { ToastProvider } from './components/ToastProvider.jsx';
import { WebSocketProvider } from './ws/WebSocketProvider.jsx';

/** Existing shared socket/router shell, extended with theme, toasts and an error boundary. */
export default function App() {
  return (
    <ErrorBoundary><ThemeProvider><ToastProvider><WebSocketProvider>
      <BrowserRouter><ReactFlowProvider><Routes>
        <Route path="/" element={<EditorPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></ReactFlowProvider></BrowserRouter>
    </WebSocketProvider></ToastProvider></ThemeProvider></ErrorBoundary>
  );
}
