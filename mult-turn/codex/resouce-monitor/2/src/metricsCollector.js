import { execFileSync } from 'child_process';
import { EventEmitter } from 'events';
import os from 'os';

const BYTES_PER_MB = 1024 * 1024;
const COLLECTION_INTERVAL_MS = 1000;
const DF_BLOCK_SIZE_BYTES = 1024;
const metricsEvents = new EventEmitter();

let previousCpuReading = readCpuTicks();
let latestSnapshot = collectSnapshot(previousCpuReading);

function readCpuTicks() {
  return os.cpus().map((cpu) => {
    const times = cpu.times;
    const total = Object.values(times).reduce((sum, time) => sum + time, 0);

    return {
      idle: times.idle,
      total,
    };
  });
}

function calculateCpuPercentages(currentReading) {
  const totals = currentReading.reduce(
    (acc, current, index) => {
      const previous = previousCpuReading[index] ?? current;
      const idleDelta = current.idle - previous.idle;
      const totalDelta = current.total - previous.total;

      return {
        idle: acc.idle + idleDelta,
        total: acc.total + totalDelta,
      };
    },
    { idle: 0, total: 0 },
  );

  if (totals.total <= 0) {
    return {
      idlePercent: 0,
      usagePercent: 0,
    };
  }

  const idlePercent = clampPercent((totals.idle / totals.total) * 100);
  const usagePercent = clampPercent(100 - idlePercent);

  return {
    idlePercent: roundToTwoDecimals(idlePercent),
    usagePercent: roundToTwoDecimals(usagePercent),
  };
}

function collectCpuSnapshot(currentReading) {
  const cpus = os.cpus();
  const percentages = calculateCpuPercentages(currentReading);

  return {
    model: cpus[0]?.model ?? 'Unknown',
    cores: cpus.length,
    idlePercent: percentages.idlePercent,
    usagePercent: percentages.usagePercent,
    loadAverage: os.loadavg(),
  };
}

function collectMemorySnapshot() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;

  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usagePercent: roundToTwoDecimals((usedBytes / totalBytes) * 100),
    totalMB: bytesToMB(totalBytes),
    freeMB: bytesToMB(freeBytes),
    usedMB: bytesToMB(usedBytes),
  };
}

function collectDiskSnapshot() {
  try {
    const output = execFileSync('df', ['-Pk', process.cwd()], {
      encoding: 'utf8',
      timeout: 1000,
      windowsHide: true,
    });
    const lines = output.trim().split('\n');
    const dataLine = lines.at(-1);

    if (!dataLine) {
      return { error: 'Disk information is unavailable.' };
    }

    const columns = dataLine.trim().split(/\s+/);
    const totalBlocks = Number(columns[1]);
    const freeBlocks = Number(columns[3]);

    if (![totalBlocks, freeBlocks].every(Number.isFinite)) {
      return { error: 'Disk information could not be parsed.' };
    }

    const totalBytes = totalBlocks * DF_BLOCK_SIZE_BYTES;
    const freeBytes = freeBlocks * DF_BLOCK_SIZE_BYTES;
    const usedBytes = totalBytes - freeBytes;

    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usagePercent: roundToTwoDecimals((usedBytes / totalBytes) * 100),
    };
  } catch (error) {
    return {
      error: `Disk information is unavailable: ${error.message}`,
    };
  }
}

function collectUptimeSnapshot() {
  const uptimeSeconds = os.uptime();

  return {
    uptimeSeconds,
    formatted: formatDuration(uptimeSeconds),
    processUptimeSeconds: process.uptime(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
  };
}

function collectSnapshot(currentReading) {
  return {
    timestamp: new Date().toISOString(),
    cpu: collectCpuSnapshot(currentReading),
    memory: collectMemorySnapshot(),
    disk: collectDiskSnapshot(),
    uptime: collectUptimeSnapshot(),
  };
}

function refreshSnapshot() {
  const currentReading = readCpuTicks();
  latestSnapshot = collectSnapshot(currentReading);
  previousCpuReading = currentReading;
  metricsEvents.emit('snapshot', latestSnapshot);
}

function roundToTwoDecimals(value) {
  return Math.round(value * 100) / 100;
}

function bytesToMB(value) {
  return roundToTwoDecimals(value / BYTES_PER_MB);
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value));
}

function formatDuration(totalSeconds) {
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

setInterval(refreshSnapshot, COLLECTION_INTERVAL_MS);

export const VALID_METRIC_TYPES = ['cpu', 'memory', 'disk', 'uptime'];

export function getLatestSnapshot() {
  return latestSnapshot;
}

export function getLatestMetricSnapshot(type) {
  return {
    type,
    timestamp: latestSnapshot.timestamp,
    data: latestSnapshot[type],
  };
}

export function onSnapshotCollected(listener) {
  metricsEvents.on('snapshot', listener);

  return () => {
    metricsEvents.off('snapshot', listener);
  };
}
