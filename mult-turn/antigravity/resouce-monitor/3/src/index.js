import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { getFullSnapshot, getMetricByType, metricsEvents } from './metrics.js';

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = process.env.PORT || 3001;

// Client registry
const clients = new Set();

// Middleware to ensure all responses are JSON
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Unified metrics endpoint
app.get('/metrics', (req, res) => {
  res.status(200).json(getFullSnapshot());
});

// Dynamic metrics endpoint
app.get('/metrics/:type', (req, res) => {
  const { type } = req.params;
  const data = getMetricByType(type);

  if (!data) {
    return res.status(400).json({ error: `Invalid metric type: ${type}` });
  }

  res.status(200).json(data);
});

// Handle WebSocket upgrade
httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname.startsWith('/ws')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// WebSocket connection handling
wss.on('connection', (ws, request) => {
  clients.add(ws);

  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname.replace(/\/$/, ''); // Remove trailing slash
  
  const VALID_METRICS = ['cpu', 'memory', 'disk', 'uptime'];
  let initialSubs = [];
  if (pathname === '/ws/cpu') initialSubs = ['cpu'];
  else if (pathname === '/ws/memory') initialSubs = ['memory'];
  else if (pathname === '/ws/disk') initialSubs = ['disk'];
  else if (pathname === '/ws/uptime') initialSubs = ['uptime'];
  else if (pathname === '/ws/all') initialSubs = [...VALID_METRICS];

  // Use a Set for easy management of subscriptions
  ws.subscriptionSet = new Set(initialSubs);
  
  // Getter for array representation
  Object.defineProperty(ws, 'subscribedTo', {
    get: () => Array.from(ws.subscriptionSet)
  });

  // Send welcome message
  ws.send(JSON.stringify({
    event: 'connected',
    subscribedTo: ws.subscribedTo,
    validTypes: ['all', ...VALID_METRICS]
  }));

  // Send immediate snapshot if subscribed
  if (ws.subscribedTo.length > 0) {
    const fullSnapshot = getFullSnapshot();
    const filteredSnapshot = { timestamp: fullSnapshot.timestamp };
    ws.subscribedTo.forEach(type => {
      filteredSnapshot[type] = fullSnapshot[type];
    });
    ws.send(JSON.stringify(filteredSnapshot));
  }

  // Handle incoming messages
  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (e) {
      return ws.send(JSON.stringify({ event: 'error', message: 'Input was not valid JSON' }));
    }

    const { action, metrics } = message;

    // Validate action
    if (action !== 'subscribe' && action !== 'unsubscribe') {
      return ws.send(JSON.stringify({ event: 'error', message: 'Action is unknown or not supported' }));
    }

    // Validate metrics field
    if (!Array.isArray(metrics) || metrics.length === 0) {
      return ws.send(JSON.stringify({ event: 'error', message: 'At least one metric type is required' }));
    }

    // Validate metric types
    const allowedTypes = [...VALID_METRICS, 'all'];
    const unknownTypes = metrics.filter(m => !allowedTypes.includes(m));
    if (unknownTypes.length > 0) {
      return ws.send(JSON.stringify({ 
        event: 'error', 
        message: `Unknown metric type: ${unknownTypes.map(t => `'${t}'`).join(', ')}` 
      }));
    }

    // Expand "all" and filter valid metrics
    let targetMetrics = [];
    metrics.forEach(m => {
      if (m === 'all') targetMetrics.push(...VALID_METRICS);
      else if (VALID_METRICS.includes(m)) targetMetrics.push(m);
    });
    targetMetrics = [...new Set(targetMetrics)]; // Unique

    if (action === 'subscribe') {
      const added = [];
      targetMetrics.forEach(m => {
        if (!ws.subscriptionSet.has(m)) {
          ws.subscriptionSet.add(m);
          added.push(m);
        }
      });

      // Ack
      ws.send(JSON.stringify({
        event: 'ack',
        action: 'subscribe',
        metrics: added,
        subscribedTo: ws.subscribedTo
      }));

      // Immediate snapshot for newly added types only
      if (added.length > 0) {
        const fullSnapshot = getFullSnapshot();
        const filteredSnapshot = { timestamp: fullSnapshot.timestamp };
        added.forEach(type => {
          filteredSnapshot[type] = fullSnapshot[type];
        });
        ws.send(JSON.stringify(filteredSnapshot));
      }
    } else if (action === 'unsubscribe') {
      const removed = [];
      targetMetrics.forEach(m => {
        if (ws.subscriptionSet.has(m)) {
          ws.subscriptionSet.delete(m);
          removed.push(m);
        }
      });

      // Ack
      ws.send(JSON.stringify({
        event: 'ack',
        action: 'unsubscribe',
        metrics: removed,
        subscribedTo: ws.subscribedTo
      }));
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
});

// Broadcast loop
metricsEvents.on('updated', (snapshot) => {
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN && ws.subscribedTo && ws.subscribedTo.length > 0) {
      const filteredSnapshot = { timestamp: snapshot.timestamp };
      
      ws.subscribedTo.forEach(type => {
        filteredSnapshot[type] = snapshot[type];
      });
      
      ws.send(JSON.stringify(filteredSnapshot));
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});


