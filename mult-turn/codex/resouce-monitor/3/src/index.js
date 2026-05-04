import express from 'express';
import { execFile } from 'child_process';
import http from 'http';
import os from 'os';
import { promisify } from 'util';
import { WebSocket, WebSocketServer } from 'ws';

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3001;
const collectionIntervalMs = 1000;
const execFileAsync = promisify(execFile);
const metricTypeList = ['cpu', 'memory', 'disk', 'uptime'];
const metricTypes = new Set(metricTypeList);
const websocketValidTypes = ['all', ...metricTypeList];
const connectedClients = new Set();
const websocketServer = new WebSocketServer({ noServer: true });

let latestSnapshot;

function roundToTwo(value) {
  return Math.round(value * 100) / 100;
}

function readCpuTimes() {
  return os.cpus().map((cpu) => ({ ...cpu.times }));
}

function sumCpuTimes(cpuTimes) {
  return cpuTimes.reduce(
    (summary, times) => {
      const total = Object.values(times).reduce((sum, value) => sum + value, 0);

      return {
        idle: summary.idle + times.idle,
        total: summary.total + total
      };
    },
    { idle: 0, total: 0 }
  );
}

function collectCpuMetrics(previousCpuTimes, currentCpuTimes) {
  const previous = sumCpuTimes(previousCpuTimes);
  const current = sumCpuTimes(currentCpuTimes);
  const idleDelta = current.idle - previous.idle;
  const totalDelta = current.total - previous.total;
  const idlePercent = totalDelta > 0 ? roundToTwo((idleDelta / totalDelta) * 100) : 0;
  const usagePercent = roundToTwo(100 - idlePercent);
  const cpus = os.cpus();

  return {
    model: cpus[0]?.model ?? 'unknown',
    cores: cpus.length,
    idlePercent,
    usagePercent,
    loadAverage: os.loadavg()
  };
}

function collectMemoryMetrics() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const bytesPerMegabyte = 1024 * 1024;

  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usagePercent: roundToTwo((usedBytes / totalBytes) * 100),
    totalMB: roundToTwo(totalBytes / bytesPerMegabyte),
    freeMB: roundToTwo(freeBytes / bytesPerMegabyte),
    usedMB: roundToTwo(usedBytes / bytesPerMegabyte)
  };
}

async function collectDiskMetrics() {
  try {
    const { stdout } = await execFileAsync('df', ['-kP', '/']);
    const lines = stdout.trim().split('\n');
    const fields = lines[1]?.trim().split(/\s+/);

    if (!fields || fields.length < 6) {
      return { error: 'Unable to parse disk metrics' };
    }

    const totalBytes = Number(fields[1]) * 1024;
    const usedBytes = Number(fields[2]) * 1024;
    const freeBytes = Number(fields[3]) * 1024;

    if (![totalBytes, usedBytes, freeBytes].every(Number.isFinite) || totalBytes <= 0) {
      return { error: 'Unable to parse disk metrics' };
    }

    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usagePercent: roundToTwo((usedBytes / totalBytes) * 100)
    };
  } catch (error) {
    return { error: `Unable to read disk metrics: ${error.message}` };
  }
}

function formatUptime(totalSeconds) {
  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const parts = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (hours > 0 || parts.length > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0 || parts.length > 0) {
    parts.push(`${minutes}m`);
  }

  parts.push(`${remainingSeconds}s`);

  return parts.join(' ');
}

function collectUptimeMetrics() {
  const uptimeSeconds = os.uptime();

  return {
    uptimeSeconds,
    formatted: formatUptime(uptimeSeconds),
    processUptimeSeconds: process.uptime(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch()
  };
}

async function collectSnapshot(previousCpuTimes, currentCpuTimes) {
  return {
    timestamp: new Date().toISOString(),
    cpu: collectCpuMetrics(previousCpuTimes, currentCpuTimes),
    memory: collectMemoryMetrics(),
    disk: await collectDiskMetrics(),
    uptime: collectUptimeMetrics()
  };
}

async function startMetricsCollection() {
  let previousCpuTimes = readCpuTimes();

  await new Promise((resolve) => setTimeout(resolve, collectionIntervalMs));

  let currentCpuTimes = readCpuTimes();
  latestSnapshot = await collectSnapshot(previousCpuTimes, currentCpuTimes);
  previousCpuTimes = currentCpuTimes;

  setInterval(async () => {
    currentCpuTimes = readCpuTimes();
    latestSnapshot = await collectSnapshot(previousCpuTimes, currentCpuTimes);
    previousCpuTimes = currentCpuTimes;
    broadcastSnapshot(latestSnapshot);
  }, collectionIntervalMs);
}

function isWebSocketPath(requestUrl) {
  const { pathname } = new URL(requestUrl, 'http://localhost');

  return pathname === '/ws' || pathname.startsWith('/ws/');
}

function getWebSocketSubscriptions(requestUrl) {
  const { pathname } = new URL(requestUrl, 'http://localhost');
  const pathType = pathname.slice('/ws/'.length);

  if (pathname === '/ws' || pathType.includes('/')) {
    return [];
  }

  if (pathType === 'all') {
    return metricTypeList;
  }

  if (metricTypes.has(pathType)) {
    return [pathType];
  }

  return [];
}

function normalizeMetricList(metrics, { expandAll = false } = {}) {
  if (!Array.isArray(metrics)) {
    return [];
  }

  const requested = new Set(metrics.filter((metric) => typeof metric === 'string'));

  if (expandAll && requested.has('all')) {
    return metricTypeList;
  }

  return metricTypeList.filter((type) => requested.has(type));
}

function getClientSubscriptionList(client) {
  return metricTypeList.filter((type) => client.subscribedTo.has(type));
}

function getUnknownMetrics(metrics) {
  if (!Array.isArray(metrics)) {
    return [];
  }

  const validMetrics = new Set([...metricTypeList, 'all']);

  return [...new Set(metrics.filter((metric) => typeof metric === 'string' && !validMetrics.has(metric)))];
}

function sendClientError(client, message) {
  sendJson(client.socket, {
    event: 'error',
    message
  });
}

function validateClientMessage(message) {
  if (message.action !== 'subscribe' && message.action !== 'unsubscribe') {
    return {
      valid: false,
      message: `Unknown or unsupported action: ${message.action ?? 'missing'}`
    };
  }

  if (!Array.isArray(message.metrics) || message.metrics.length === 0) {
    return {
      valid: false,
      message: 'At least one metric type is required'
    };
  }

  const unknownMetrics = getUnknownMetrics(message.metrics);

  if (unknownMetrics.length > 0) {
    return {
      valid: false,
      message: `Unknown metric type: ${unknownMetrics.map((metric) => `'${metric}'`).join(', ')}`
    };
  }

  return { valid: true };
}

function buildSubscribedSnapshot(snapshot, subscribedTo) {
  return subscribedTo.reduce(
    (message, type) => ({
      ...message,
      [type]: snapshot[type]
    }),
    { timestamp: snapshot.timestamp }
  );
}

function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function broadcastSnapshot(snapshot) {
  for (const client of connectedClients) {
    const subscribedTo = getClientSubscriptionList(client);

    if (subscribedTo.length === 0) {
      continue;
    }

    const sent = sendJson(client.socket, buildSubscribedSnapshot(snapshot, subscribedTo));

    if (!sent) {
      connectedClients.delete(client);
    }
  }
}

function handleClientMessage(client, rawMessage) {
  let message;

  try {
    message = JSON.parse(rawMessage.toString());
  } catch {
    sendClientError(client, 'Message was not valid JSON');
    return;
  }

  const validation = validateClientMessage(message);

  if (!validation.valid) {
    sendClientError(client, validation.message);
    return;
  }

  if (message.action === 'subscribe') {
    const requested = normalizeMetricList(message.metrics, { expandAll: true });
    const added = requested.filter((type) => !client.subscribedTo.has(type));

    for (const type of added) {
      client.subscribedTo.add(type);
    }

    sendJson(client.socket, {
      event: 'ack',
      action: 'subscribe',
      metrics: added,
      subscribedTo: getClientSubscriptionList(client)
    });

    if (added.length > 0) {
      sendJson(client.socket, buildSubscribedSnapshot(latestSnapshot, added));
    }

    return;
  }

  if (message.action === 'unsubscribe') {
    const requested = normalizeMetricList(message.metrics);
    const removed = requested.filter((type) => client.subscribedTo.has(type));

    for (const type of removed) {
      client.subscribedTo.delete(type);
    }

    sendJson(client.socket, {
      event: 'ack',
      action: 'unsubscribe',
      metrics: removed,
      subscribedTo: getClientSubscriptionList(client)
    });
  }
}

function registerWebSocketClient(socket, request) {
  const subscribedTo = new Set(getWebSocketSubscriptions(request.url ?? '/ws'));
  const client = { socket, subscribedTo };
  const subscriptionList = getClientSubscriptionList(client);

  connectedClients.add(client);

  sendJson(socket, {
    event: 'connected',
    subscribedTo: subscriptionList,
    validTypes: websocketValidTypes
  });

  if (subscriptionList.length > 0) {
    sendJson(socket, buildSubscribedSnapshot(latestSnapshot, subscriptionList));
  }

  const unregister = () => {
    connectedClients.delete(client);
  };

  socket.on('close', unregister);
  socket.on('error', unregister);
  socket.on('message', (message) => handleClientMessage(client, message));
}

websocketServer.on('connection', registerWebSocketClient);

server.on('upgrade', (request, socket, head) => {
  if (!isWebSocketPath(request.url ?? '/')) {
    socket.destroy();
    return;
  }

  websocketServer.handleUpgrade(request, socket, head, (websocket) => {
    websocketServer.emit('connection', websocket, request);
  });
});

app.use((req, res, next) => {
  res.type('application/json');
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/metrics', (req, res) => {
  res.status(200).json(latestSnapshot);
});

app.get('/metrics/:type', (req, res) => {
  const { type } = req.params;

  if (!metricTypes.has(type)) {
    return res.status(400).json({ error: `Unsupported metric type: ${type}` });
  }

  res.status(200).json({
    type,
    timestamp: latestSnapshot.timestamp,
    data: latestSnapshot[type]
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

await startMetricsCollection();

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
