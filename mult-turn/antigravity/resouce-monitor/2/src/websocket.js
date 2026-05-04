import { WebSocketServer, WebSocket } from 'ws';
import { getCpuMetrics, getMemoryMetrics, getDiskMetrics, getUptimeMetrics, metricsEvents } from './metrics.js';

const clients = new Set();

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  metricsEvents.on('update', (metrics) => {
    broadcastMetrics(metrics);
  });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/ws')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, request) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname.replace(/\/$/, ''); // Remove trailing slash
    
    let subscribedTo = [];
    if (pathname === '/ws/cpu') subscribedTo = ['cpu'];
    else if (pathname === '/ws/memory') subscribedTo = ['memory'];
    else if (pathname === '/ws/disk') subscribedTo = ['disk'];
    else if (pathname === '/ws/uptime') subscribedTo = ['uptime'];
    else if (pathname === '/ws/all') subscribedTo = ['cpu', 'memory', 'disk', 'uptime'];

    ws.subscriptions = new Set(subscribedTo);
    
    // Helper to get subscriptions as array
    const getSubsArray = () => Array.from(ws.subscriptions);

    clients.add(ws);

    // Send welcome message
    const welcomeMessage = {
      event: 'connected',
      subscribedTo: getSubsArray(),
      validTypes: ['all', 'cpu', 'memory', 'disk', 'uptime']
    };

    ws.send(JSON.stringify(welcomeMessage));

    // Send immediate snapshot if subscribed
    const currentSubs = getSubsArray();
    if (currentSubs.length > 0) {
      const snapshot = { timestamp: new Date().toISOString() };
      
      if (currentSubs.includes('cpu')) snapshot.cpu = getCpuMetrics().data;
      if (currentSubs.includes('memory')) snapshot.memory = getMemoryMetrics().data;
      if (currentSubs.includes('disk')) snapshot.disk = getDiskMetrics().data;
      if (currentSubs.includes('uptime')) snapshot.uptime = getUptimeMetrics().data;
      
      const firstMetric = currentSubs.includes('cpu') ? getCpuMetrics() : 
                         currentSubs.includes('memory') ? getMemoryMetrics() :
                         currentSubs.includes('disk') ? getDiskMetrics() :
                         getUptimeMetrics();
      snapshot.timestamp = firstMetric.timestamp;

      ws.send(JSON.stringify(snapshot));
    }

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        const { action, metrics } = message;

        if (action === 'subscribe' && Array.isArray(metrics)) {
          let toAdd = metrics;
          if (metrics.includes('all')) {
            toAdd = ['cpu', 'memory', 'disk', 'uptime'];
          }

          const added = [];
          toAdd.forEach(m => {
            if (['cpu', 'memory', 'disk', 'uptime'].includes(m) && !ws.subscriptions.has(m)) {
              ws.subscriptions.add(m);
              added.push(m);
            }
          });

          ws.send(JSON.stringify({
            event: 'ack',
            action: 'subscribe',
            metrics: added,
            subscribedTo: getSubsArray()
          }));

          if (added.length > 0) {
            const snapshot = { timestamp: new Date().toISOString() };
            if (added.includes('cpu')) snapshot.cpu = getCpuMetrics().data;
            if (added.includes('memory')) snapshot.memory = getMemoryMetrics().data;
            if (added.includes('disk')) snapshot.disk = getDiskMetrics().data;
            if (added.includes('uptime')) snapshot.uptime = getUptimeMetrics().data;

            const firstMetric = added.includes('cpu') ? getCpuMetrics() : 
                               added.includes('memory') ? getMemoryMetrics() :
                               added.includes('disk') ? getDiskMetrics() :
                               getUptimeMetrics();
            snapshot.timestamp = firstMetric.timestamp;
            ws.send(JSON.stringify(snapshot));
          }
        } else if (action === 'unsubscribe' && Array.isArray(metrics)) {
          let toRemove = metrics;
          if (metrics.includes('all')) {
            toRemove = ['cpu', 'memory', 'disk', 'uptime'];
          }

          const removed = [];
          toRemove.forEach(m => {
            if (ws.subscriptions.has(m)) {
              ws.subscriptions.delete(m);
              removed.push(m);
            }
          });

          ws.send(JSON.stringify({
            event: 'ack',
            action: 'unsubscribe',
            metrics: removed,
            subscribedTo: getSubsArray()
          }));
        }
      } catch (err) {
        // Silently ignore invalid JSON
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  return wss;
}

function broadcastMetrics(metrics) {
  for (const client of clients) {
    const subscriptions = Array.from(client.subscriptions || []);
    if (client.readyState === WebSocket.OPEN && subscriptions.length > 0) {
      const snapshot = { timestamp: metrics.timestamp };
      
      for (const type of subscriptions) {
        if (metrics[type]) {
          snapshot[type] = metrics[type];
        }
      }

      client.send(JSON.stringify(snapshot));
    }
  }
}

export function getClients() {
  return clients;
}
