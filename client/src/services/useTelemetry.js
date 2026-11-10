import { useEffect, useState } from 'react';

/** Same-origin WebSocket, with bounded UI updates and automatic reconnect. */
export function useTelemetry() {
  const [socketStatus, setSocketStatus] = useState('connecting');
  const [readings, setReadings] = useState([]);

  useEffect(() => {
    let socket;
    let retry;
    let disposed = false;
    let attempts = 0;
    let pending = [];
    const flush = setInterval(() => {
      if (pending.length) {
        setReadings(pending.slice(-3).reverse());
        pending = [];
      }
    }, 500);

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket.onopen = () => { attempts = 0; if (!disposed) setSocketStatus('connected'); };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'telemetry') {
            const received = Array.isArray(message.data) ? message.data : [message.data];
            pending = [...pending, ...received.slice(-3)].slice(-3);
          }
        } catch { /* Ignore malformed messages from the server. */ }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (disposed) return;
        setSocketStatus('disconnected');
        const delay = Math.min(1000 * 2 ** attempts, 30_000);
        attempts += 1;
        retry = setTimeout(connect, delay);
      };
    }
    connect();
    return () => {
      disposed = true;
      clearInterval(flush);
      clearTimeout(retry);
      socket?.close();
    };
  }, []);
  return { socketStatus, readings };
}
