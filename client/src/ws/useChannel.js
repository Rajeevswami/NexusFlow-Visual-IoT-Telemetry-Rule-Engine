import { useEffect, useRef } from 'react';
import { useWebSocket } from './WebSocketProvider.jsx';

/**
 * One-line channel subscription:
 *
 *   useChannel('alerts', (message) => console.log(message.data));
 *
 * The socket subscription is created once per channel; the handler is kept in a ref
 * so callers may pass an inline closure without resubscribing. Unsubscribes on
 * unmount (no leaked handlers, no orphan channels on the server).
 *
 * @param {string | null} channel e.g. "telemetry:turbine-001", "alerts", "graph:<id>"
 * @param {(message: { type: string, data: any }) => void} handler
 */
export function useChannel(channel, handler) {
  const ws = useWebSocket();
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; }, [handler]);

  useEffect(() => {
    if (!ws || !channel) return undefined;
    return ws.subscribe(channel, (message) => handlerRef.current?.(message));
  }, [ws, channel]);
}
