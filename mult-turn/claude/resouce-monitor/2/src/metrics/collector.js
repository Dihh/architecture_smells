import os from 'os';
import { execSync } from 'child_process';
import { EventEmitter } from 'events';

export const collectorEvents = new EventEmitter();

const INTERVAL_MS = 1000;

let cache = { cpu: null, memory: null, disk: null, uptime: null };
let previousCpuTicks = null;

function sampleCpuTicks() {
  return os.cpus().map(({ times }) => ({ ...times }));
}

function computeCpuDelta(prev, curr) {
  let totalIdle = 0;
  let totalTicks = 0;

  for (let i = 0; i < curr.length; i++) {
    const delta = {};
    for (const field of Object.keys(curr[i])) {
      delta[field] = curr[i][field] - (prev[i]?.[field] ?? 0);
    }
    const coreTicks = Object.values(delta).reduce((a, b) => a + b, 0);
    totalIdle += delta.idle;
    totalTicks += coreTicks;
  }

  if (totalTicks === 0) return { idlePercent: 100, usagePercent: 0 };

  const idlePercent = parseFloat(((totalIdle / totalTicks) * 100).toFixed(2));
  const usagePercent = parseFloat((100 - idlePercent).toFixed(2));
  return { idlePercent, usagePercent };
}

function collectMemory(timestamp) {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const usagePercent = parseFloat(((usedBytes / totalBytes) * 100).toFixed(2));
  const toMB = (b) => parseFloat((b / 1024 / 1024).toFixed(2));

  cache.memory = {
    type: 'memory',
    timestamp,
    data: {
      totalBytes,
      freeBytes,
      usedBytes,
      usagePercent,
      totalMB: toMB(totalBytes),
      freeMB: toMB(freeBytes),
      usedMB: toMB(usedBytes),
    },
  };
}

function collectCpu(timestamp) {
  const cpus = os.cpus();
  const currentTicks = sampleCpuTicks();
  const { idlePercent, usagePercent } = previousCpuTicks
    ? computeCpuDelta(previousCpuTicks, currentTicks)
    : { idlePercent: 100, usagePercent: 0 };

  previousCpuTicks = currentTicks;

  cache.cpu = {
    type: 'cpu',
    timestamp,
    data: {
      model: cpus[0].model,
      cores: cpus.length,
      idlePercent,
      usagePercent,
      loadAverage: os.loadavg(),
    },
  };
}

function collectDisk(timestamp) {
  try {
    const output = execSync('df -Pk / 2>/dev/null', { timeout: 2000 }).toString().trim();
    const line = output.split('\n')[1];
    const parts = line.trim().split(/\s+/);
    const totalBytes = parseInt(parts[1], 10) * 1024;
    const usedBytes = parseInt(parts[2], 10) * 1024;
    const freeBytes = parseInt(parts[3], 10) * 1024;
    const usagePercent = parseFloat(((usedBytes / totalBytes) * 100).toFixed(2));
    cache.disk = {
      type: 'disk',
      timestamp,
      data: { totalBytes, freeBytes, usedBytes, usagePercent },
    };
  } catch (err) {
    cache.disk = {
      type: 'disk',
      timestamp,
      data: { error: err.message },
    };
  }
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function collectUptime(timestamp) {
  const uptimeSeconds = os.uptime();
  cache.uptime = {
    type: 'uptime',
    timestamp,
    data: {
      uptimeSeconds,
      formatted: formatUptime(uptimeSeconds),
      processUptimeSeconds: process.uptime(),
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
    },
  };
}

function tick() {
  const timestamp = new Date().toISOString();
  collectCpu(timestamp);
  collectMemory(timestamp);
  collectDisk(timestamp);
  collectUptime(timestamp);
  collectorEvents.emit('tick', cache);
}

export function startCollector() {
  // Prime the first CPU baseline before starting the interval so the first
  // real tick can compute a meaningful delta immediately.
  previousCpuTicks = sampleCpuTicks();
  tick();
  setInterval(tick, INTERVAL_MS).unref();
}

export function getCache() {
  return cache;
}
