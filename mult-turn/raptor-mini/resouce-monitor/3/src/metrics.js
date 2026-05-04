import os from "os";
import { execSync } from "child_process";

let cpuCache = null;
let memoryCache = null;
let diskCache = null;
let uptimeCache = null;
let prevCpuTimes = null;
let intervalId = null;
let onRefreshCallback = null;

function aggregateCpuTimes() {
  const cpus = os.cpus();
  const cores = cpus.length;
  const model = cores > 0 ? cpus[0].model : "";
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    const times = cpu.times;
    const cpuTotal = Object.values(times).reduce((sum, value) => sum + value, 0);
    idle += times.idle;
    total += cpuTotal;
  }

  return { idle, total, model, cores, loadAverage: os.loadavg() };
}

function toMB(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

function computeCpuUsage(prev, current) {
  const deltaIdle = current.idle - prev.idle;
  const deltaTotal = current.total - prev.total;

  if (deltaTotal <= 0) {
    return 0;
  }

  const usage = ((deltaTotal - deltaIdle) / deltaTotal) * 100;
  return Number(usage.toFixed(2));
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(" ");
}

function parseDfOutput(output) {
  const lines = output.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { error: "Unable to parse disk usage" };
  }

  const row = lines[lines.length - 1].trim().split(/\s+/);
  if (row.length < 6) {
    return { error: "Unable to parse disk usage" };
  }

  const totalKB = Number(row[1]);
  const usedKB = Number(row[2]);
  const freeKB = Number(row[3]);

  if (!Number.isFinite(totalKB) || totalKB <= 0) {
    return { error: "Unable to parse disk usage" };
  }

  const totalBytes = totalKB * 1024;
  const freeBytes = freeKB * 1024;
  const usedBytes = usedKB * 1024;
  const usagePercent = Number(((usedBytes / totalBytes) * 100).toFixed(2));

  return { totalBytes, freeBytes, usedBytes, usagePercent };
}

function parseWmicOutput(output) {
  const values = {};
  for (const line of output.trim().split(/\r?\n/)) {
    const [key, value] = line.split("=");
    if (key && value) {
      values[key.trim()] = value.trim();
    }
  }

  const totalBytes = Number(values.Size);
  const freeBytes = Number(values.FreeSpace);

  if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(freeBytes)) {
    return { error: "Unable to parse disk usage" };
  }

  const usedBytes = totalBytes - freeBytes;
  const usagePercent = Number(((usedBytes / totalBytes) * 100).toFixed(2));

  return { totalBytes, freeBytes, usedBytes, usagePercent };
}

function readDiskMetrics() {
  try {
    if (process.platform === "win32") {
      const output = execSync(
        "wmic logicaldisk where \"DeviceID='C:'\" get FreeSpace,Size /format:list",
        { encoding: "utf8" }
      );
      return parseWmicOutput(output);
    }

    const output = execSync("df -k /", { encoding: "utf8" });
    return parseDfOutput(output);
  } catch (error) {
    return { error: `Disk information unavailable: ${error.message}` };
  }
}

function refreshMetrics() {
  const currentCpuTimes = aggregateCpuTimes();
  const timestamp = new Date().toISOString();

  const cpuUsagePercent = prevCpuTimes
    ? computeCpuUsage(prevCpuTimes, currentCpuTimes)
    : 0;
  const cpuIdlePercent = Number((100 - cpuUsagePercent).toFixed(2));

  cpuCache = {
    type: "cpu",
    timestamp,
    data: {
      model: currentCpuTimes.model,
      cores: currentCpuTimes.cores,
      idlePercent: cpuIdlePercent,
      usagePercent: cpuUsagePercent,
      loadAverage: currentCpuTimes.loadAverage,
    },
  };

  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const memoryUsagePercent = totalBytes === 0 ? 0 : Number(((usedBytes / totalBytes) * 100).toFixed(2));

  memoryCache = {
    type: "memory",
    timestamp,
    data: {
      totalBytes,
      freeBytes,
      usedBytes,
      usagePercent: memoryUsagePercent,
      totalMB: toMB(totalBytes),
      freeMB: toMB(freeBytes),
      usedMB: toMB(usedBytes),
    },
  };

  const diskData = readDiskMetrics();
  diskCache = {
    type: "disk",
    timestamp,
    data: diskData.error ? { error: diskData.error } : diskData,
  };

  uptimeCache = {
    type: "uptime",
    timestamp,
    data: {
      uptimeSeconds: Number(os.uptime()),
      formatted: formatDuration(os.uptime()),
      processUptimeSeconds: Number(process.uptime()),
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
    },
  };

  prevCpuTimes = currentCpuTimes;

  return {
    timestamp,
    cpu: cpuCache.data,
    memory: memoryCache.data,
    disk: diskCache.data,
    uptime: uptimeCache.data,
  };
}

export function initMetrics(intervalMs = 1000, onRefresh = null) {
  if (intervalId) {
    return;
  }

  onRefreshCallback = typeof onRefresh === "function" ? onRefresh : null;
  prevCpuTimes = aggregateCpuTimes();
  const snapshot = refreshMetrics();
  if (onRefreshCallback) {
    try {
      onRefreshCallback(snapshot);
    } catch (error) {
      // ignore callback errors to keep metrics refreshing
    }
  }

  intervalId = setInterval(() => {
    const intervalSnapshot = refreshMetrics();
    if (onRefreshCallback) {
      try {
        onRefreshCallback(intervalSnapshot);
      } catch (error) {
        // ignore callback errors to keep metrics refreshing
      }
    }
  }, intervalMs);
}

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

export function getMetricsSnapshot() {
  const snapshotTimestamp = cpuCache?.timestamp || memoryCache?.timestamp || diskCache?.timestamp || uptimeCache?.timestamp || new Date().toISOString();
  return {
    timestamp: snapshotTimestamp,
    cpu: cpuCache?.data ?? null,
    memory: memoryCache?.data ?? null,
    disk: diskCache?.data ?? null,
    uptime: uptimeCache?.data ?? null,
  };
}
