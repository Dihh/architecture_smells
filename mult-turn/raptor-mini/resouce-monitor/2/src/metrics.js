import EventEmitter from 'events';
import os from 'os';
import { spawnSync } from 'child_process';

const SAMPLE_INTERVAL_MS = 1000;
const metricsEvents = new EventEmitter();

let previousCpuSnapshot = os.cpus();
let latestSnapshot = createSnapshot(previousCpuSnapshot, previousCpuSnapshot);

function aggregateCpuTimes(cpus) {
  return cpus.reduce(
    (acc, cpu) => {
      const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
      return {
        model: acc.model || cpu.model,
        cores: acc.cores + 1,
        idle: acc.idle + cpu.times.idle,
        total: acc.total + total,
      };
    },
    { model: '', cores: 0, idle: 0, total: 0 }
  );
}

function calculateCpuInfo(previousCpus, currentCpus) {
  const previous = aggregateCpuTimes(previousCpus);
  const current = aggregateCpuTimes(currentCpus);
  const deltaTotal = current.total - previous.total;
  const deltaIdle = current.idle - previous.idle;
  const idlePercent = deltaTotal > 0 ? (deltaIdle / deltaTotal) * 100 : 0;
  const usagePercent = 100 - idlePercent;

  return {
    model: current.model,
    cores: current.cores,
    idlePercent: Number(idlePercent.toFixed(2)),
    usagePercent: Number(usagePercent.toFixed(2)),
    loadAverage: os.loadavg(),
  };
}

function calculateMemoryInfo() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const usagePercent = totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(2)) : 0;

  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usagePercent,
    totalMB: totalBytes / 1024 / 1024,
    freeMB: freeBytes / 1024 / 1024,
    usedMB: usedBytes / 1024 / 1024,
  };
}

function formatUptime(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const parts = [];

  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

function calculateUptimeInfo() {
  const uptimeSeconds = os.uptime();

  return {
    uptimeSeconds: Number(uptimeSeconds),
    formatted: formatUptime(uptimeSeconds),
    processUptimeSeconds: Number(process.uptime()),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
  };
}

function runDfCommand(args) {
  const result = spawnSync('df', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr?.trim() || 'df command failed');
  }
  return result.stdout;
}

function parseDiskOutput(output, parser) {
  const cleaned = output.trim();
  if (!cleaned) {
    throw new Error('df output is empty');
  }
  return parser(cleaned);
}

function calculateDiskInfo() {
  const attempts = [
    {
      args: ['--output=size,avail', '-B1', '/'],
      parser: (output) => {
        const lines = output.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) throw new Error('unexpected df output');
        const values = lines[1].trim().split(/\s+/);
        if (values.length < 2) throw new Error('unexpected df output columns');
        const totalBytes = Number(values[0]);
        const freeBytes = Number(values[1]);
        if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes)) {
          throw new Error('invalid disk values');
        }
        return { totalBytes, freeBytes };
      },
    },
    {
      args: ['--output=size,avail', '-k', '/'],
      parser: (output) => {
        const lines = output.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) throw new Error('unexpected df output');
        const values = lines[1].trim().split(/\s+/);
        if (values.length < 2) throw new Error('unexpected df output columns');
        const totalBytes = Number(values[0]) * 1024;
        const freeBytes = Number(values[1]) * 1024;
        if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes)) {
          throw new Error('invalid disk values');
        }
        return { totalBytes, freeBytes };
      },
    },
    {
      args: ['-k', '/'],
      parser: (output) => {
        const lines = output.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) throw new Error('unexpected df output');
        const values = lines[1].trim().split(/\s+/);
        if (values.length < 4) throw new Error('unexpected df output columns');
        const totalBytes = Number(values[1]) * 1024;
        const freeBytes = Number(values[3]) * 1024;
        if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes)) {
          throw new Error('invalid disk values');
        }
        return { totalBytes, freeBytes };
      },
    },
  ];

  for (const attempt of attempts) {
    try {
      const output = runDfCommand(attempt.args);
      const { totalBytes, freeBytes } = parseDiskOutput(output, attempt.parser);
      const usedBytes = totalBytes - freeBytes;
      const usagePercent = totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(2)) : 0;
      return { totalBytes, freeBytes, usedBytes, usagePercent };
    } catch (_) {
      continue;
    }
  }

  return { error: 'Disk information unavailable on this platform' };
}

function createSnapshot(previousCpus, currentCpus) {
  return {
    timestamp: new Date().toISOString(),
    cpu: calculateCpuInfo(previousCpus, currentCpus),
    memory: calculateMemoryInfo(),
    disk: calculateDiskInfo(),
    uptime: calculateUptimeInfo(),
  };
}

function refreshSnapshot() {
  const currentCpuSnapshot = os.cpus();
  latestSnapshot = createSnapshot(previousCpuSnapshot, currentCpuSnapshot);
  previousCpuSnapshot = currentCpuSnapshot;
  metricsEvents.emit('snapshot', latestSnapshot);
}

const intervalHandle = setInterval(refreshSnapshot, SAMPLE_INTERVAL_MS);

// Ensure the cache is refreshed on every interval tick.
refreshSnapshot();

export function getLatestMetrics() {
  return latestSnapshot;
}

export function onSnapshot(listener) {
  metricsEvents.on('snapshot', listener);
}

export function stopMetricsCollection() {
  clearInterval(intervalHandle);
}
