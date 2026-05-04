import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { getLatestMetrics, onSnapshot } from './metrics.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/metrics', (req, res) => {
  const snapshot = getLatestMetrics();
  res.status(200).json(snapshot);
});

const validMetricTypes = new Set(['cpu', 'memory', 'disk', 'uptime']);

app.get('/metrics/:type', (req, res) => {
  const { type } = req.params;
  if (!validMetricTypes.has(type)) {
    return res.status(400).json({ error: `Invalid metric type: ${type}` });
  }

  const snapshot = getLatestMetrics();
  return res.status(200).json({ type, timestamp: snapshot.timestamp, data: snapshot[type] });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

const server = http.createServer(app);
const clients = new Set();
const validWsTypes = ['all', 'cpu', 'memory', 'disk', 'uptime'];

const wsServer = new WebSocketServer({ noServer: true });

const subscriptionMap = new Map([
  ['', []],
  ['/', []],
  ['/cpu', ['cpu']],
  ['/memory', ['memory']],
  ['/disk', ['disk']],
  ['/uptime', ['uptime']],
  ['/all', ['cpu', 'memory', 'disk', 'uptime']],
]);

function buildSnapshotForSubscription(snapshot, subscribedTo) {
  const message = { timestamp: snapshot.timestamp };
  for (const type of subscribedTo) {
    if (type in snapshot) {
      message[type] = snapshot[type];
    }
  }
  return message;
}

function sendSnapshotToClient(socket, snapshot) {
  if (!socket.subscribedTo || socket.subscribedTo.size === 0) {
    return;
  }
  const message = buildSnapshotForSubscription(snapshot, socket.subscribedTo);
  try {
    socket.send(JSON.stringify(message));
  } catch {
    clients.delete(socket);
  }
}

function sendAck(socket, action, metrics, subscribedTo) {
  const ack = {
    event: 'ack',
    action,
    metrics,
    subscribedTo,
  };
  try {
    socket.send(JSON.stringify(ack));
  } catch {
    clients.delete(socket);
  }
}

function sendError(socket, message) {
  try {
    socket.send(JSON.stringify({ event: 'error', message }));
  } catch {
    clients.delete(socket);
  }
}

function normalizeRequestedMetrics(metrics) {
  if (!Array.isArray(metrics)) {
    return { error: 'At least one metric type is required.', types: null };
  }

  if (metrics.length === 0) {
    return { error: 'At least one metric type is required.', types: null };
  }

  const expanded = new Set();
  const unknownTypes = [];

  for (const type of metrics) {
    if (type === 'all') {
      for (const validType of validMetricTypes) {
        expanded.add(validType);
      }
      continue;
    }

    if (typeof type !== 'string' || (!validMetricTypes.has(type) && type !== 'all')) {
      unknownTypes.push(type);
      continue;
    }

    expanded.add(type);
  }

  if (unknownTypes.length > 0) {
    const quoted = unknownTypes.map((t) => JSON.stringify(t)).join(', ');
    return { error: `Unknown metric type: ${quoted}`, types: null };
  }

  return { error: null, types: Array.from(expanded) };
}

onSnapshot((snapshot) => {
  for (const socket of clients) {
    if (socket.subscribedTo && socket.subscribedTo.size > 0) {
      sendSnapshotToClient(socket, snapshot);
    }
  }
});

function getSubscriptionPath(url) {
  try {
    const path = new URL(url, 'http://localhost').pathname;
    if (!path.startsWith('/ws')) {
      return '';
    }
    const suffix = path.slice(3).replace(/\/+$/, '') || '';
    return suffix;
  } catch {
    return '';
  }
}

wsServer.on('connection', (socket, req) => {
  clients.add(socket);

  const subscriptionPath = getSubscriptionPath(req.url || '');
  socket.subscribedTo = new Set(subscriptionMap.get(subscriptionPath) ?? []);

  const welcomeMessage = {
    event: 'connected',
    subscribedTo: Array.from(socket.subscribedTo),
    validTypes: validWsTypes,
  };

  socket.send(JSON.stringify(welcomeMessage));

  if (socket.subscribedTo.size > 0) {
    const snapshot = getLatestMetrics();
    socket.send(JSON.stringify(buildSnapshotForSubscription(snapshot, socket.subscribedTo)));
  }

  socket.on('message', (message) => {
    let payload;
    try {
      payload = JSON.parse(message.toString());
    } catch {
      sendError(socket, 'Invalid JSON input.');
      return;
    }

    if (!payload || typeof payload !== 'object') {
      sendError(socket, 'Unknown action.');
      return;
    }

    const { action, metrics } = payload;
    if (action !== 'subscribe' && action !== 'unsubscribe') {
      sendError(socket, 'Unknown or unsupported action.');
      return;
    }

    const normalized = normalizeRequestedMetrics(metrics);
    if (normalized.error) {
      sendError(socket, normalized.error);
      return;
    }

    const requestedTypes = normalized.types;
    if (!requestedTypes) {
      sendError(socket, 'At least one metric type is required.');
      return;
    }

    if (action === 'subscribe') {
      const addedTypes = [];
      for (const type of requestedTypes) {
        if (!socket.subscribedTo.has(type)) {
          socket.subscribedTo.add(type);
          addedTypes.push(type);
        }
      }

      const subscribedToArray = Array.from(socket.subscribedTo);
      sendAck(socket, 'subscribe', addedTypes, subscribedToArray);

      if (addedTypes.length > 0) {
        const snapshot = getLatestMetrics();
        socket.send(JSON.stringify(buildSnapshotForSubscription(snapshot, addedTypes)));
      }
      return;
    }

    if (action === 'unsubscribe') {
      const removedTypes = [];
      for (const type of requestedTypes) {
        if (socket.subscribedTo.delete(type)) {
          removedTypes.push(type);
        }
      }

      sendAck(socket, 'unsubscribe', removedTypes, Array.from(socket.subscribedTo));
      return;
    }
  });

  socket.on('close', () => {
    clients.delete(socket);
  });

  socket.on('error', () => {
    clients.delete(socket);
  });
});

server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/ws')) {
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      wsServer.emit('connection', ws, req);
    });
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
