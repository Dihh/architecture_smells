import { WebSocketServer } from 'ws';
import { getSnapshot, onTick } from './metrics.js';

export const VALID_WS_TYPES = ['all', 'cpu', 'memory', 'disk', 'uptime'];
const METRIC_TYPES = ['cpu', 'memory', 'disk', 'uptime'];

// Map of socket → subscribedTo string[]
const clients = new Map();

function resolveSubscription(url) {
  const segment = url.split('?')[0].slice('/ws'.length).replace(/^\//, '');
  if (!segment) return [];
  if (segment === 'all') return [...METRIC_TYPES];
  if (METRIC_TYPES.includes(segment)) return [segment];
  return [];
}

function buildSnapshot(subscribedTo) {
  const snap = { timestamp: getSnapshot(subscribedTo[0]).timestamp };
  for (const type of subscribedTo) {
    snap[type] = getSnapshot(type).data;
  }
  return snap;
}

function broadcastTick(cache) {
  for (const [socket, subscribedTo] of clients) {
    if (subscribedTo.length === 0 || socket.readyState !== socket.OPEN) continue;
    const msg = { timestamp: cache.cpu.timestamp };
    for (const type of subscribedTo) msg[type] = cache[type].data;
    socket.send(JSON.stringify(msg));
  }
}

export function createWsServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  onTick(broadcastTick);

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (socket, req) => {
    const subscribedTo = resolveSubscription(req.url);
    clients.set(socket, subscribedTo);

    socket.send(JSON.stringify({
      event: 'connected',
      subscribedTo,
      validTypes: VALID_WS_TYPES,
    }));

    if (subscribedTo.length > 0) {
      socket.send(JSON.stringify(buildSnapshot(subscribedTo)));
    }

    socket.on('message', (raw) => {
      const err = (message) => socket.send(JSON.stringify({ event: 'error', message }));

      let msg;
      try { msg = JSON.parse(raw); } catch {
        return err('Invalid JSON: message could not be parsed.');
      }

      const { action, metrics } = msg;

      if (action !== 'subscribe' && action !== 'unsubscribe') {
        return err(action === undefined
          ? 'Missing action field. Expected "subscribe" or "unsubscribe".'
          : `Unknown action: "${action}". Expected "subscribe" or "unsubscribe".`);
      }

      if (!Array.isArray(metrics) || metrics.length === 0) {
        return err('Missing or empty "metrics" field. At least one metric type is required.');
      }

      const unknown = metrics.filter(t => !VALID_WS_TYPES.includes(t));
      if (unknown.length > 0) {
        return err(unknown.map(t => `Unknown metric type: "${t}"`).join(', '));
      }

      // Expand "all" and deduplicate
      const requested = [...new Set(
        metrics.flatMap(t => t === 'all' ? METRIC_TYPES : [t])
      )];

      const current = clients.get(socket);

      if (action === 'subscribe') {
        const added = requested.filter(t => !current.includes(t));
        const updated = [...current, ...added];
        clients.set(socket, updated);

        socket.send(JSON.stringify({ event: 'ack', action, metrics: added, subscribedTo: updated }));
        if (added.length > 0) socket.send(JSON.stringify(buildSnapshot(added)));
      } else {
        const removed = requested.filter(t => current.includes(t));
        const updated = current.filter(t => !requested.includes(t));
        clients.set(socket, updated);

        socket.send(JSON.stringify({ event: 'ack', action, metrics: removed, subscribedTo: updated }));
      }
    });

    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  return wss;
}

export { clients };
