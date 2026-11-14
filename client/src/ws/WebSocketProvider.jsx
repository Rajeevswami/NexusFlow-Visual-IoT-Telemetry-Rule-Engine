import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * WebSocket context: one socket for the whole app, channel-based subscriptions,
 * exponential-backoff reconnect and defensive message parsing.
 *
 * Channel protocol (mirrors the server):
 *   telemetry:<deviceId>  device telemetry        (also the catch-all `telemetry`)
 *   alerts                every fired alert
 *   graph:<graphId>       alert + node_activity + graph_status for one graph
 *
 * `subscribe(channels, handler)` returns an unsubscribe function; channels are
 * (re-)sent to the server on every (re)connect, so a reconnect never leaks or drops
 * a subscription.
 */

const WebSocketContext = createContext(null);

/**
 * Where the socket connects.
 *
 * Same-origin by default (the Vite dev proxy and the production nginx/reverse proxy
 * both forward `/ws`), but a separately hosted frontend must be told where the API
 * lives — otherwise the browser would dial its own origin and get a 404. In production
 * this must be a `wss://` URL: browsers reject insecure WebSockets from HTTPS pages.
 */
function wsUrl() {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) {
    const url = new URL(configured, window.location.origin);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    return url.toString();
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/** Which channels carry a given server message. */
function channelsFor(message) {
  const { type, data } = message;
  if (type === 'telemetry') {
    const deviceId = data?.metadata?.deviceId;
    return deviceId ? [`telemetry:${deviceId}`, 'telemetry'] : ['telemetry'];
  }
  if (type === 'alert' || type === 'delivery') return data?.graphId ? ['alerts', `graph:${data.graphId}`] : ['alerts'];
  if (type === 'node_activity' || type === 'edge_activity' || type === 'graph_status') {
    return data?.graphId ? [`graph:${data.graphId}`] : [];
  }
  return []; // connected / subscribed / ack / pong / error — handled by the provider itself
}

export function WebSocketProvider({ children }) {
  const [status, setStatus] = useState('connecting');
  const socketRef = useRef(null);
  /** @type {React.MutableRefObject<Map<string, Set<(msg: object) => void>>>} */
  const channelsRef = useRef(new Map());
  const attemptsRef = useRef(0);
  const retryTimerRef = useRef(null);

  const send = useCallback((message) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    try { socket.send(JSON.stringify(message)); return true; }
    catch { return false; }
  }, []);

  /** Subscribe to one or more channels; returns the unsubscribe function. */
  const subscribe = useCallback((channels, handler) => {
    const list = (Array.isArray(channels) ? channels : [channels]).filter((c) => typeof c === 'string' && c);
    const added = [];
    for (const channel of list) {
      let handlers = channelsRef.current.get(channel);
      if (!handlers) { handlers = new Set(); channelsRef.current.set(channel, handlers); added.push(channel); }
      handlers.add(handler);
    }
    if (added.length) send({ type: 'subscribe', channels: added });
    return () => {
      const removed = [];
      for (const channel of list) {
        const handlers = channelsRef.current.get(channel);
        if (!handlers) continue;
        handlers.delete(handler);
        if (handlers.size === 0) { channelsRef.current.delete(channel); removed.push(channel); }
      }
      if (removed.length) send({ type: 'unsubscribe', channels: removed });
    };
  }, [send]);

  useEffect(() => {
    // Disposal is scoped to this effect run: React StrictMode (and real unmounts)
    // must never let a stale socket's onclose schedule a duplicate connection.
    let disposed = false;
    let socket = null;

    const scheduleRetry = () => {
      // Exponential backoff: 0.5s, 1s, 2s, ... capped at 30s.
      const delay = Math.min(500 * 2 ** attemptsRef.current, 30_000);
      attemptsRef.current += 1;
      retryTimerRef.current = setTimeout(connect, delay);
    };

    const dispatch = (message) => {
      const targets = channelsFor(message);
      for (const channel of targets) {
        const handlers = channelsRef.current.get(channel);
        if (!handlers) continue;
        for (const handler of handlers) {
          try { handler(message); }
          catch (error) { console.error('WebSocket handler failed:', error); }
        }
      }
    };

    function connect() {
      if (disposed) return;
      try { socket = new WebSocket(wsUrl()); }
      catch { scheduleRetry(); return; }
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) { try { socket.close(); } catch { /* noop */ } return; }
        attemptsRef.current = 0;
        setStatus('connected');
        const channels = [...channelsRef.current.keys()];
        if (channels.length) send({ type: 'subscribe', channels }); // re-subscribe after reconnect
      };
      socket.onmessage = (event) => {
        if (disposed) return;
        let message;
        try { message = JSON.parse(event.data); }
        catch { return; } // never crash on malformed frames
        if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
        if (message.type === 'connected') return;
        if (message.type === 'error') { console.warn('WebSocket server error:', message.data?.message); return; }
        dispatch(message);
      };
      socket.onerror = () => { try { socket.close(); } catch { /* already closed */ } };
      socket.onclose = () => {
        if (disposed) return;
        if (socketRef.current === socket) socketRef.current = null;
        setStatus('disconnected');
        scheduleRetry();
      };
    }

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      try { socket?.close(); } catch { /* already closed */ }
      if (socketRef.current === socket) socketRef.current = null;
      setStatus('disconnected');
    };
  }, [send]);

  const value = useMemo(() => ({
    status,
    subscribe,
    send,
    reconnectNow: () => {
      attemptsRef.current = 0;
      clearTimeout(retryTimerRef.current);
      try { socketRef.current?.close(); } catch { /* noop */ }
    },
  }), [status, subscribe, send]);

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

/** @returns {{ status: string, subscribe: Function, send: Function, reconnectNow: Function } | null} */
export function useWebSocket() {
  return useContext(WebSocketContext);
}
