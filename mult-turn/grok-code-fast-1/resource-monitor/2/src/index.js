import express from 'express';
import os from 'os';
import { execSync } from 'child_process';
import { WebSocketServer } from 'ws';

const app = express();

const PORT = process.env.PORT || 3001;

const clients = new Map();

let cpuSnapshot = null;
let memorySnapshot = null;
let diskSnapshot = null;
let uptimeSnapshot = null;
let combinedSnapshot = null;
let previousCpuTimes = null;

const collectMetrics = () => {
  const timestamp = new Date().toISOString();

  // Memory collection
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const totalMB = Math.round(totalBytes / (1024 * 1024));
  const freeMB = Math.round(freeBytes / (1024 * 1024));
  const usedMB = Math.round(usedBytes / (1024 * 1024));

  memorySnapshot = {
    type: 'memory',
    timestamp,
    data: {
      totalBytes,
      freeBytes,
      usedBytes,
      usagePercent: Math.round((usedBytes / totalBytes) * 10000) / 100,
      totalMB,
      freeMB,
      usedMB
    }
  };

  // Disk collection
  try {
    const dfOutput = execSync('df -k /').toString();
    const lines = dfOutput.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    const parts = lastLine.split(/\s+/);
    const totalKB = parseInt(parts[1]);
    const usedKB = parseInt(parts[2]);
    const freeKB = parseInt(parts[3]);
    const usagePercent = parseInt(parts[4].replace('%', ''));
    const totalBytes = totalKB * 1024;
    const usedBytes = usedKB * 1024;
    const freeBytes = freeKB * 1024;
    diskSnapshot = {
      type: 'disk',
      timestamp,
      data: {
        totalBytes,
        freeBytes,
        usedBytes,
        usagePercent
      }
    };
  } catch (e) {
    diskSnapshot = {
      type: 'disk',
      timestamp,
      data: {
        error: e.message
      }
    };
  }

  // Uptime collection
  const uptimeSeconds = os.uptime();
  const processUptimeSeconds = process.uptime();
  const hostname = os.hostname();
  const platform = os.platform();
  const arch = os.arch();
  const formatUptime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}h ${minutes}m ${secs}s`;
  };
  const formatted = formatUptime(uptimeSeconds);
  uptimeSnapshot = {
    type: 'uptime',
    timestamp,
    data: {
      uptimeSeconds,
      formatted,
      processUptimeSeconds,
      hostname,
      platform,
      arch
    }
  };

  // CPU collection
  const cpus = os.cpus();
  const model = cpus[0].model;
  const cores = cpus.length;
  const loadAverage = os.loadavg();

  let idlePercent = 0;
  let usagePercent = 0;

  if (previousCpuTimes) {
    let totalDelta = 0;
    let idleDelta = 0;
    for (let i = 0; i < cpus.length; i++) {
      const prev = previousCpuTimes[i];
      const curr = cpus[i].times;
      const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
      const currTotal = curr.user + curr.nice + curr.sys + curr.idle + curr.irq;
      const deltaTotal = currTotal - prevTotal;
      const deltaIdle = curr.idle - prev.idle;
      totalDelta += deltaTotal;
      idleDelta += deltaIdle;
    }
    idlePercent = (idleDelta / totalDelta) * 100;
    usagePercent = 100 - idlePercent;
  }

  previousCpuTimes = cpus.map(cpu => ({ ...cpu.times }));

  cpuSnapshot = {
    type: 'cpu',
    timestamp,
    data: {
      model,
      cores,
      idlePercent,
      usagePercent,
      loadAverage
    }
  };

  // Combined snapshot
  combinedSnapshot = {
    timestamp,
    cpu: cpuSnapshot.data,
    memory: memorySnapshot.data,
    disk: diskSnapshot.data,
    uptime: uptimeSnapshot.data
  };

  // Broadcast to subscribed clients
  for (const [ws, clientData] of clients) {
    const { subscribedTo } = clientData;
    if (subscribedTo.length > 0) {
      const snapshot = { timestamp: combinedSnapshot.timestamp };
      subscribedTo.forEach(type => {
        snapshot[type] = combinedSnapshot[type];
      });
      try {
        ws.send(JSON.stringify(snapshot));
      } catch (e) {
        // Client may have disconnected, ignore
      }
    }
  }
};

// Initialize metrics
collectMetrics();

// Collect metrics every ~1 second
setInterval(collectMetrics, 1000);

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/metrics', (req, res) => {
  if (!combinedSnapshot) {
    return res.status(503).json({ error: 'Metrics not ready' });
  }
  res.json(combinedSnapshot);
});

app.get('/metrics/:type', (req, res) => {
  const { type } = req.params;
  const validTypes = ['cpu', 'memory', 'disk', 'uptime'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `Invalid metric type: ${type}` });
  }
  let snapshot;
  switch (type) {
    case 'cpu':
      snapshot = cpuSnapshot;
      break;
    case 'memory':
      snapshot = memorySnapshot;
      break;
    case 'disk':
      snapshot = diskSnapshot;
      break;
    case 'uptime':
      snapshot = uptimeSnapshot;
      break;
  }
  if (!snapshot) {
    return res.status(503).json({ error: 'Metrics not ready' });
  }
  res.json(snapshot);
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  if (!req.url.startsWith('/ws')) {
    ws.close();
    return;
  }

  const path = req.url;
  let subscribedTo = [];
  if (path === '/ws') {
    subscribedTo = [];
  } else if (path === '/ws/cpu') {
    subscribedTo = ['cpu'];
  } else if (path === '/ws/memory') {
    subscribedTo = ['memory'];
  } else if (path === '/ws/disk') {
    subscribedTo = ['disk'];
  } else if (path === '/ws/uptime') {
    subscribedTo = ['uptime'];
  } else if (path === '/ws/all') {
    subscribedTo = ['cpu', 'memory', 'disk', 'uptime'];
  } else {
    ws.close();
    return;
  }

  clients.set(ws, { subscribedTo });

  const welcome = {
    event: "connected",
    subscribedTo,
    validTypes: ["all", "cpu", "memory", "disk", "uptime"]
  };

  ws.send(JSON.stringify(welcome));

  if (subscribedTo.length > 0) {
    const snapshot = { timestamp: combinedSnapshot.timestamp };
    subscribedTo.forEach(type => {
      snapshot[type] = combinedSnapshot[type];
    });
    ws.send(JSON.stringify(snapshot));
  }

  ws.on('message', (data) => {
    const sendError = (message) => {
      ws.send(JSON.stringify({ event: 'error', message }));
    };

    try {
      const msg = JSON.parse(data.toString());

      if (!msg.action) {
        sendError('Missing action field');
      } else if (msg.action !== 'subscribe' && msg.action !== 'unsubscribe') {
        sendError(`Unknown action: ${msg.action}`);
      } else {
        if (!msg.metrics) {
          sendError('Missing metrics field');
        } else if (!Array.isArray(msg.metrics)) {
          sendError('Metrics must be an array');
        } else if (msg.metrics.length === 0) {
          sendError('At least one metric type is required');
        } else {
          const validTypes = ['cpu', 'memory', 'disk', 'uptime', 'all'];
          const unknown = msg.metrics.filter(m => !validTypes.includes(m));
          if (unknown.length > 0) {
            sendError(`Unknown metric type(s): ${unknown.join(', ')}`);
          } else {
            // Proceed with subscribe/unsubscribe
            const { action, metrics } = msg;
            const clientData = clients.get(ws);
            let currentSubscribed = [...clientData.subscribedTo];
            let added = [];
            let removed = [];
            if (action === 'subscribe') {
              let toAdd = [];
              metrics.forEach(m => {
                if (m === 'all') {
                  toAdd.push(...validTypes.slice(0, 4)); // cpu, memory, disk, uptime
                } else {
                  toAdd.push(m);
                }
              });
              toAdd = [...new Set(toAdd)];
              toAdd.forEach(type => {
                if (!currentSubscribed.includes(type)) {
                  currentSubscribed.push(type);
                  added.push(type);
                }
              });
            } else if (action === 'unsubscribe') {
              metrics.forEach(m => {
                if (currentSubscribed.includes(m)) {
                  currentSubscribed = currentSubscribed.filter(t => t !== m);
                  removed.push(m);
                }
              });
            }
            clientData.subscribedTo = currentSubscribed;
            const ack = {
              event: 'ack',
              action,
              metrics: action === 'subscribe' ? added : removed,
              subscribedTo: currentSubscribed
            };
            ws.send(JSON.stringify(ack));
            if (action === 'subscribe' && added.length > 0) {
              const snapshot = { timestamp: combinedSnapshot.timestamp };
              added.forEach(type => {
                snapshot[type] = combinedSnapshot[type];
              });
              ws.send(JSON.stringify(snapshot));
            }
          }
        }
      }
    } catch (e) {
      sendError('Invalid JSON');
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});