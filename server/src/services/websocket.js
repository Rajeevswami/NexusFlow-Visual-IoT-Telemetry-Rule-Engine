import { WebSocket, WebSocketServer } from 'ws';

let socketServer;
const maxBufferedBytes = 1024 * 1024;

export function attachWebSocketServer(httpServer) {
  socketServer = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 64 * 1024 });
  socketServer.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('error', (error) => console.error('WebSocket error:', error.message));
    socket.send(JSON.stringify({ type: 'connected', data: { message: 'Connected to NexusFlow' } }));
  });
  socketServer.on('error', (error) => console.error('WebSocket server error:', error.message));

  // Remove broken connections; unref prevents this timer from keeping Node alive.
  const heartbeat = setInterval(() => {
    for (const socket of socketServer.clients) {
      if (!socket.isAlive) socket.terminate();
      else { socket.isAlive = false; socket.ping(); }
    }
  }, 30_000);
  heartbeat.unref();
  socketServer.on('close', () => clearInterval(heartbeat));
  return socketServer;
}

/**
 * Best-effort fan-out. A slow or dead client must never block ingestion or make the
 * server buffer unbounded data, so anything over `maxBufferedBytes` is skipped.
 *
 * @param {string} type message type, for example "telemetry" or "alert"
 * @param {unknown} data payload
 */
function broadcast(type, data) {
  if (!socketServer || socketServer.clients.size === 0) return;
  const message = JSON.stringify({ type, data });
  for (const socket of socketServer.clients) {
    if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > maxBufferedBytes) continue;
    socket.send(message, (error) => {
      if (error) console.error('WebSocket broadcast failed:', error.message);
    });
  }
}

/** Push freshly ingested telemetry to every connected client. */
export function broadcastTelemetry(data) {
  broadcast('telemetry', data);
}

/** Push an alert raised by a compiled pipeline to every connected client. */
export function broadcastAlert(data) {
  broadcast('alert', data);
}
