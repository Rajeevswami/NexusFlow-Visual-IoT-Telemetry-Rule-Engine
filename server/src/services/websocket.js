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

/** Best-effort delivery: a slow client must never block ingestion or consume unbounded memory. */
export function broadcastTelemetry(data) {
  if (!socketServer || socketServer.clients.size === 0) return;
  const message = JSON.stringify({ type: 'telemetry', data });
  for (const socket of socketServer.clients) {
    if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > maxBufferedBytes) continue;
    socket.send(message, (error) => {
      if (error) console.error('WebSocket broadcast failed:', error.message);
    });
  }
}
