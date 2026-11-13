import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, TriangleAlert, X } from 'lucide-react';
const ToastContext = createContext(null);
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const notify = useCallback((message, type = 'success') => {
    clearTimeout(timer.current); setToast({ message, type });
    timer.current = setTimeout(() => setToast(null), 6000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <ToastContext.Provider value={notify}>{children}{toast && <div className={`toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
    {toast.type === 'error' ? <TriangleAlert size={17} /> : <CheckCircle2 size={17} />}<span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={16} /></button>
  </div>}</ToastContext.Provider>;
}
export function useToast() { return useContext(ToastContext) ?? (() => {}); }
