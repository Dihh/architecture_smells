import { WebSocketServer } from 'ws';
import { getCache, collectorEvents } from '../metrics/collector.js';

export const VALID_TYPES = ['all', 'cpu', 'memory', 'disk', 'uptime'];
const METRIC_TYPES = ['cpu', 'memory', 'disk', 'uptime'];

const clients = new Map(); // ws → subscribedTo array

export function getClients() {
  return clients;
}

function resolveSubscription(pathname) {
  const segment = pathname.slice('/ws'.length).replace(/^\//, '');
  if (!segment) return [];
  if (segment === 'all') return [...METRIC_TYPES];
  if (METRIC_TYPES.includes(segment)) return [segment];
  return [];
}

function buildSnapshot(subscribedTo) {
  const cache = getCache();
  const snapshot = { timestamp: null };
  for (const type of subscribedTo) {
    const entry = cache[type];
    if (entry) {
      snapshot.timestamp = entry.timestamp;
      snapshot[type] = entry.data;
    }
  }
  return snapshot;
}

function broadcast(cache) {
  for (const [ws, subscribedTo] of clients) {
    if (subscribedTo.length === 0 || ws.readyState !== ws.OPEN) continue;
    const snapshot = buildSnapshot(subscribedTo);
    ws.send(JSON.stringify(snapshot));
  }
}

export function createWsServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  collectorEvents.on('tick', broadcast);

  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    if (pathname !== '/ws' && !pathname.startsWith('/ws/')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws, req) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    const subscribedTo = resolveSubscription(pathname);
    clients.set(ws, subscribedTo);

    ws.send(JSON.stringify({
      event: 'connected',
      subscribedTo,
      validTypes: VALID_TYPES,
    }));

    if (subscribedTo.length > 0) {
      ws.send(JSON.stringify(buildSnapshot(subscribedTo)));
    }

    ws.on('message', (raw) => {
      const err = (message) => ws.send(JSON.stringify({ event: 'error', message }));

      let msg;
      try { msg = JSON.parse(raw); } catch {
        return err('Invalid JSON: message could not be parsed');
      }

      const { action, metrics } = msg;

      if (action !== 'subscribe' && action !== 'unsubscribe') {
        return err(action === undefined
          ? 'Missing action: "action" field is required'
          : `Unknown action: "${action}"`);
      }

      const metricsArray = Array.isArray(metrics) ? metrics : [];
      if (metricsArray.length === 0) {
        return err('At least one metric type is required');
      }

      const unknown = metricsArray.filter(m => !VALID_TYPES.includes(m));
      if (unknown.length > 0) {
        return err(unknown.map(m => `Unknown metric type: '${m}'`).join('; '));
      }

      const expanded = [...new Set(
        metricsArray.flatMap(m => m === 'all' ? METRIC_TYPES : [m])
      )];

      const current = new Set(clients.get(ws));

      if (action === 'subscribe') {
        const added = expanded.filter(m => !current.has(m));
        expanded.forEach(m => current.add(m));
        const subscribedTo = [...current];
        clients.set(ws, subscribedTo);
        ws.send(JSON.stringify({ event: 'ack', action, metrics: added, subscribedTo }));
        if (added.length > 0) ws.send(JSON.stringify(buildSnapshot(added)));
      } else {
        const removed = expanded.filter(m => current.has(m));
        expanded.forEach(m => current.delete(m));
        const subscribedTo = [...current];
        clients.set(ws, subscribedTo);
        ws.send(JSON.stringify({ event: 'ack', action, metrics: removed, subscribedTo }));
      }
    });

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  return wss;
}
