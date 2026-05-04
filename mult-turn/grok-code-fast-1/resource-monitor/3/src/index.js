import express from 'express';
import os from 'os';
import { execSync } from 'child_process';
import WebSocket, { WebSocketServer } from 'ws';

const app = express();

const port = process.env.PORT || 3001;

// WebSocket clients registry: ws -> subscribedTo array
const clients = new Map();

// Metrics cache
let cpuSnapshot = { data: null, timestamp: null };
let memorySnapshot = { data: null, timestamp: null };
let diskSnapshot = { data: null, timestamp: null };
let uptimeSnapshot = { data: null, timestamp: null };
let prevTotal = 0;
let prevIdle = 0;

// Collect CPU metrics
function collectCPU() {
  const cpus = os.cpus();
  const numCores = cpus.length;
  const model = cpus[0].model.trim();
  const loadAverage = os.loadavg();

  const total = cpus.reduce((sum, cpu) => sum + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq, 0);
  const idle = cpus.reduce((sum, cpu) => sum + cpu.times.idle, 0);

  if (prevTotal === 0) {
    prevTotal = total;
    prevIdle = idle;
    return {
      model,
      cores: numCores,
      idlePercent: 100,
      usagePercent: 0,
      loadAverage
    };
  } else {
    const totalDelta = total - prevTotal;
    const idleDelta = idle - prevIdle;
    const usagePercent = 100 - Math.round((idleDelta / totalDelta) * 100);
    const idlePercent = 100 - usagePercent;
    prevTotal = total;
    prevIdle = idle;
    return {
      model,
      cores: numCores,
      idlePercent,
      usagePercent,
      loadAverage
    };
  }
}

// Collect memory metrics
function collectMemory() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const usagePercent = Math.round((usedBytes / totalBytes) * 100 * 100) / 100;
  const totalMB = Math.round(totalBytes / 1024 / 1024);
  const freeMB = Math.round(freeBytes / 1024 / 1024);
  const usedMB = totalMB - freeMB;
  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usagePercent,
    totalMB,
    freeMB,
    usedMB
  };
}

// Collect disk metrics
function collectDisk() {
  try {
    const output = execSync('df -k /', { encoding: 'utf8' });
    const lines = output.trim().split('\n');
    if (lines.length < 2) throw new Error('Invalid df output');
    const data = lines[1].split(/\s+/);
    const totalKB = parseInt(data[1]);
    const usedKB = parseInt(data[2]);
    const freeKB = parseInt(data[3]);
    const totalBytes = totalKB * 1024;
    const usedBytes = usedKB * 1024;
    const freeBytes = freeKB * 1024;
    const usagePercent = parseFloat(data[4].replace('%', ''));
    return { totalBytes, freeBytes, usedBytes, usagePercent };
  } catch (e) {
    return { error: e.message };
  }
}

// Collect uptime metrics
function collectUptime() {
  const uptimeSeconds = os.uptime();
  const processUptimeSeconds = process.uptime();
  const hostname = os.hostname();
  const platform = os.platform();
  const arch = os.arch();
  const formatted = formatUptime(uptimeSeconds);
  return { uptimeSeconds, formatted, processUptimeSeconds, hostname, platform, arch };
}

// Format uptime seconds to human-readable string
function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}h ${minutes}m ${secs}s`;
}

// Initial collection
cpuSnapshot.data = collectCPU();
memorySnapshot.data = collectMemory();
diskSnapshot.data = collectDisk();
uptimeSnapshot.data = collectUptime();
const initialTimestamp = new Date().toISOString();
cpuSnapshot.timestamp = initialTimestamp;
memorySnapshot.timestamp = initialTimestamp;
diskSnapshot.timestamp = initialTimestamp;
uptimeSnapshot.timestamp = initialTimestamp;

// Set up interval collection
setInterval(() => {
  cpuSnapshot.data = collectCPU();
  memorySnapshot.data = collectMemory();
  diskSnapshot.data = collectDisk();
  uptimeSnapshot.data = collectUptime();
  const timestamp = new Date().toISOString();
  cpuSnapshot.timestamp = timestamp;
  memorySnapshot.timestamp = timestamp;
  diskSnapshot.timestamp = timestamp;
  uptimeSnapshot.timestamp = timestamp;

  // Broadcast to subscribed clients
  for (const [ws, subscribedTo] of clients) {
    if (subscribedTo.length > 0 && ws.readyState === WebSocket.OPEN) {
      const snapshot = { timestamp };
      if (subscribedTo.includes('cpu')) snapshot.cpu = cpuSnapshot.data;
      if (subscribedTo.includes('memory')) snapshot.memory = memorySnapshot.data;
      if (subscribedTo.includes('disk')) snapshot.disk = diskSnapshot.data;
      if (subscribedTo.includes('uptime')) snapshot.uptime = uptimeSnapshot.data;
      ws.send(JSON.stringify(snapshot));
    }
  }
}, 1000);

// Middleware to ensure JSON responses have correct Content-Type
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: "ok" });
});

// Metrics endpoints
app.get('/metrics', (req, res) => {
  res.json({
    timestamp: cpuSnapshot.timestamp,
    cpu: cpuSnapshot.data,
    memory: memorySnapshot.data,
    disk: diskSnapshot.data,
    uptime: uptimeSnapshot.data
  });
});

app.get('/metrics/:type', (req, res) => {
  const { type } = req.params;
  const validTypes = ['cpu', 'memory', 'disk', 'uptime'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `Invalid metric type: ${type}` });
  }
  let snapshot;
  switch (type) {
    case 'cpu': snapshot = cpuSnapshot; break;
    case 'memory': snapshot = memorySnapshot; break;
    case 'disk': snapshot = diskSnapshot; break;
    case 'uptime': snapshot = uptimeSnapshot; break;
  }
  res.json({ type, timestamp: snapshot.timestamp, data: snapshot.data });
});

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
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

  clients.set(ws, subscribedTo);

  ws.send(JSON.stringify({
    event: "connected",
    subscribedTo,
    validTypes: ["all", "cpu", "memory", "disk", "uptime"]
  }));

  if (subscribedTo.length > 0) {
    const snapshot = { timestamp: cpuSnapshot.timestamp };
    if (subscribedTo.includes('cpu')) snapshot.cpu = cpuSnapshot.data;
    if (subscribedTo.includes('memory')) snapshot.memory = memorySnapshot.data;
    if (subscribedTo.includes('disk')) snapshot.disk = diskSnapshot.data;
    if (subscribedTo.includes('uptime')) snapshot.uptime = uptimeSnapshot.data;
    ws.send(JSON.stringify(snapshot));
  }

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      ws.send(JSON.stringify({ event: "error", message: "Invalid JSON received" }));
      return;
    }

    if (!msg.action) {
      ws.send(JSON.stringify({ event: "error", message: "Missing action field" }));
      return;
    }

    if (msg.action !== 'subscribe' && msg.action !== 'unsubscribe') {
      ws.send(JSON.stringify({ event: "error", message: `Unknown action: '${msg.action}'` }));
      return;
    }

    if (!msg.metrics || !Array.isArray(msg.metrics)) {
      ws.send(JSON.stringify({ event: "error", message: "At least one metric type is required" }));
      return;
    }

    if (msg.metrics.length === 0) {
      ws.send(JSON.stringify({ event: "error", message: "At least one metric type is required" }));
      return;
    }

    const validTypes = ['cpu', 'memory', 'disk', 'uptime'];
    if (msg.action === 'subscribe') {
      validTypes.push('all');
    }

    const unknowns = msg.metrics.filter(m => !validTypes.includes(m));
    if (unknowns.length > 0) {
      ws.send(JSON.stringify({ event: "error", message: `Unknown metric type(s): ${unknowns.map(u => `'${u}'`).join(', ')}` }));
      return;
    }

    // Proceed with subscribe/unsubscribe
    if (msg.action === 'subscribe') {
      let metrics = msg.metrics;
      if (metrics.includes('all')) {
        metrics = ['cpu', 'memory', 'disk', 'uptime'];
      }
      // Already filtered above
      
      const current = clients.get(ws) || [];
      const added = metrics.filter(m => !current.includes(m));
      current.push(...added);
      const updated = [...new Set(current)];
      clients.set(ws, updated);
      
      ws.send(JSON.stringify({
        event: 'ack',
        action: 'subscribe',
        metrics: added,
        subscribedTo: updated
      }));
      
      if (added.length > 0) {
        const snapshot = { timestamp: cpuSnapshot.timestamp };
        if (added.includes('cpu')) snapshot.cpu = cpuSnapshot.data;
        if (added.includes('memory')) snapshot.memory = memorySnapshot.data;
        if (added.includes('disk')) snapshot.disk = diskSnapshot.data;
        if (added.includes('uptime')) snapshot.uptime = uptimeSnapshot.data;
        ws.send(JSON.stringify(snapshot));
      }
    } else if (msg.action === 'unsubscribe') {
      const metrics = msg.metrics; // Already validated
      const current = clients.get(ws) || [];
      const removed = metrics.filter(m => current.includes(m));
      const updated = current.filter(m => !removed.includes(m));
      clients.set(ws, updated);
      
      ws.send(JSON.stringify({
        event: 'ack',
        action: 'unsubscribe',
        metrics: removed,
        subscribedTo: updated
      }));
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});