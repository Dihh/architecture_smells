import os from 'os';
import { execSync } from 'child_process';
import { EventEmitter } from 'events';

export const metricsEvents = new EventEmitter();

let cpuCache = null;
let memoryCache = null;
let diskCache = null;
let uptimeCache = null;
let lastCpuInfo = getCpuInfo();

function getCpuInfo() {
  const cpus = os.cpus();
  return cpus.map(cpu => {
    const total = Object.values(cpu.times).reduce((acc, tv) => acc + tv, 0);
    return {
      idle: cpu.times.idle,
      total: total
    };
  });
}

function calculateCpuUsage() {
  const currentCpuInfo = getCpuInfo();
  let totalDiff = 0;
  let idleDiff = 0;

  for (let i = 0; i < currentCpuInfo.length; i++) {
    totalDiff += currentCpuInfo[i].total - lastCpuInfo[i].total;
    idleDiff += currentCpuInfo[i].idle - lastCpuInfo[i].idle;
  }

  lastCpuInfo = currentCpuInfo;

  const idlePercent = totalDiff === 0 ? 0 : (idleDiff / totalDiff) * 100;
  const usagePercent = 100 - idlePercent;

  return {
    model: os.cpus()[0].model,
    cores: os.cpus().length,
    idlePercent: Number(idlePercent.toFixed(2)),
    usagePercent: Number(usagePercent.toFixed(2)),
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
    usagePercent: Number(usagePercent.toFixed(2)),
    totalMB: Math.round(totalBytes / (1024 * 1024)),
    freeMB: Math.round(freeBytes / (1024 * 1024)),
    usedMB: Math.round(usedBytes / (1024 * 1024))
  };
}

function getDiskUsage() {
  try {
    const output = execSync('df -B1 / --output=size,avail,used,pcent | tail -1').toString().trim();
    const [size, avail, used, pcent] = output.split(/\s+/);
    
    const totalBytes = parseInt(size, 10);
    const freeBytes = parseInt(avail, 10);
    const usedBytes = parseInt(used, 10);
    const usagePercent = parseInt(pcent.replace('%', ''), 10);

    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usagePercent
    };
  } catch (err) {
    return { error: 'Failed to read disk info: ' + err.message };
  }
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  
  return parts.join(' ');
}

function getUptimeInfo() {
  const uptimeSeconds = os.uptime();
  return {
    uptimeSeconds,
    formatted: formatDuration(uptimeSeconds),
    processUptimeSeconds: Math.floor(process.uptime()),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch()
  };
}

function updateMetrics() {
  const timestamp = new Date().toISOString();
  
  cpuCache = {
    type: 'cpu',
    timestamp,
    data: calculateCpuUsage()
  };

  memoryCache = {
    type: 'memory',
    timestamp,
    data: getMemoryUsage()
  };

  diskCache = {
    type: 'disk',
    timestamp,
    data: getDiskUsage()
  };

  uptimeCache = {
    type: 'uptime',
    timestamp,
    data: getUptimeInfo()
  };

  metricsEvents.emit('update', getFullMetrics());
}

// Initial update to populate cache
// Note: CPU usage needs two readings, so the first one will be 0 or based on small diff
updateMetrics();

// Start interval
setInterval(updateMetrics, 1000);

export function getCpuMetrics() {
  return cpuCache;
}

export function getMemoryMetrics() {
  return memoryCache;
}

export function getDiskMetrics() {
  return diskCache;
}

export function getUptimeMetrics() {
  return uptimeCache;
}

export function getFullMetrics() {
  return {
    timestamp: cpuCache.timestamp,
    cpu: cpuCache.data,
    memory: memoryCache.data,
    disk: diskCache.data,
    uptime: uptimeCache.data
  };
}
