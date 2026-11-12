import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from '../ws/WebSocketProvider.jsx';
import { useChannel } from '../ws/useChannel.js';

/**
 * Same-origin live telemetry for the editor inspector.
 *
 * Day 3: the server no longer blanket-broadcasts — this hook now subscribes to the
 * catch-all `telemetry` channel through the shared WebSocket provider, so it shares
 * one socket (and one reconnect loop) with the rest of the app.
 *
 * Incoming messages are buffered in a ref and flushed into state at most every
 * 500 ms (same bounded-update behaviour as Day 1), keeping the editor render path
 * cheap even under a hot device stream.
 */
export function useTelemetry() {
  const ws = useWebSocket();
  const [socketStatus, setSocketStatus] = useState('connecting');
  const [readings, setReadings] = useState([]);
  const pendingRef = useRef([]);
  const flushTimerRef = useRef(null);

  useEffect(() => {
    setSocketStatus(ws?.status ?? 'connecting');
  }, [ws?.status]);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const pending = pendingRef.current;
    if (pending.length === 0) return;
    pendingRef.current = [];
    // Newest first, bounded to the 3 rows the inspector renders.
    setReadings((current) => [...pending.reverse(), ...current].slice(0, 3));
  }, []);

  const onTelemetry = useCallback((message) => {
    const received = Array.isArray(message.data) ? message.data : [message.data];
    for (const reading of received) {
      if (reading && typeof reading === 'object') pendingRef.current.push(reading);
    }
    if (pendingRef.current.length > 24) pendingRef.current = pendingRef.current.slice(-12);
    if (flushTimerRef.current === null) flushTimerRef.current = setTimeout(flush, 500);
  }, [flush]);
  useChannel('telemetry', onTelemetry);

  useEffect(() => () => clearTimeout(flushTimerRef.current), []);

  return { socketStatus, readings };
}
