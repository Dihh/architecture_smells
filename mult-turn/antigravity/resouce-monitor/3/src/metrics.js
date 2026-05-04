import os from 'os';
import { execSync } from 'child_process';
import { EventEmitter } from 'events';

export const metricsEvents = new EventEmitter();

let metricsCache = {
  cpu: null,
  memory: null,
  disk: null,
  uptime: null,
  timestamp: null
};

let lastCpus = os.cpus();

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

function calculateCpuUsage() {
  const currentCpus = os.cpus();
  let totalDiff = 0;
  let idleDiff = 0;

  for (let i = 0; i < currentCpus.length; i++) {
    const last = lastCpus[i].times;
    const current = currentCpus[i].times;

    const lastTotal = last.user + last.nice + last.sys + last.idle + last.irq;
    const currentTotal = current.user + current.nice + current.sys + current.idle + current.irq;

    totalDiff += currentTotal - lastTotal;
    idleDiff += current.idle - last.idle;
  }

  const usagePercent = totalDiff > 0 ? (1 - idleDiff / totalDiff) * 100 : 0;
  const idlePercent = 100 - usagePercent;

  lastCpus = currentCpus;

  return {
    model: currentCpus[0].model,
    cores: currentCpus.length,
    idlePercent: parseFloat(idlePercent.toFixed(2)),
    usagePercent: parseFloat(usagePercent.toFixed(2)),
    loadAverage: os.loadavg()
  };
}

function getMemoryUsage() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const usagePercent = (usedBytes / totalBytes) * 100;

  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usagePercent: parseFloat(usagePercent.toFixed(2)),
    totalMB: Math.round(totalBytes / (1024 * 1024)),
    freeMB: Math.round(freeBytes / (1024 * 1024)),
    usedMB: Math.round(usedBytes / (1024 * 1024))
  };
}

function getDiskUsage() {
  try {
    const output = execSync('df -Pk /').toString();
    const lines = output.trim().split('\n');
    if (lines.length < 2) throw new Error('Unexpected df output');

    const parts = lines[1].split(/\s+/);
    const totalBlocks = parseInt(parts[1], 10);
    const usedBlocks = parseInt(parts[2], 10);
    const availableBlocks = parseInt(parts[3], 10);

    const totalBytes = totalBlocks * 1024;
    const usedBytes = usedBlocks * 1024;
    const freeBytes = availableBlocks * 1024;
    const usagePercent = (usedBytes / totalBytes) * 100;

    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usagePercent: parseFloat(usagePercent.toFixed(2))
    };
  } catch (error) {
    return { error: `Failed to read disk info: ${error.message}` };
  }
}

function getUptimeMetrics() {
  const uptimeSeconds = os.uptime();
  return {
    uptimeSeconds,
    formatted: formatUptime(uptimeSeconds),
    processUptimeSeconds: Math.floor(process.uptime()),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch()
  };
}

function updateMetrics() {
  const timestamp = new Date().toISOString();

  metricsCache = {
    timestamp,
    cpu: calculateCpuUsage(),
    memory: getMemoryUsage(),
    disk: getDiskUsage(),
    uptime: getUptimeMetrics()
  };

  metricsEvents.emit('updated', metricsCache);
}

// Initial collection
updateMetrics();

// Set interval for collection
setInterval(updateMetrics, 1000);

export function getFullSnapshot() {
  return metricsCache;
}

export function getMetricByType(type) {
  if (!metricsCache[type] || type === 'timestamp') {
    return null;
  }
  return {
    type,
    timestamp: metricsCache.timestamp,
    data: metricsCache[type]
  };
}
