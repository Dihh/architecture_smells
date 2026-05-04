import os from 'os';
import { execSync } from 'child_process';

function getCpuTotals() {
  return os.cpus().map(({ times }) => {
    const total = Object.values(times).reduce((a, b) => a + b, 0);
    return { idle: times.idle, total };
  });
}

function computeCpuPercents(prev, curr) {
  let idleSum = 0, totalSum = 0;
  for (let i = 0; i < curr.length; i++) {
    const idle = curr[i].idle - prev[i].idle;
    const total = curr[i].total - prev[i].total;
    idleSum += idle;
    totalSum += total;
  }
  const idlePercent = totalSum === 0 ? 0 : (idleSum / totalSum) * 100;
  return {
    idlePercent: Math.round(idlePercent * 100) / 100,
    usagePercent: Math.round((100 - idlePercent) * 100) / 100,
  };
}

function snapshotMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    totalBytes: total,
    freeBytes: free,
    usedBytes: used,
    usagePercent: Math.round((used / total) * 10000) / 100,
    totalMB: Math.round(total / 1024 / 1024 * 100) / 100,
    freeMB: Math.round(free / 1024 / 1024 * 100) / 100,
    usedMB: Math.round(used / 1024 / 1024 * 100) / 100,
  };
}

function snapshotDisk() {
  try {
    // df -k / gives 1K-block counts; POSIX-standard on Linux and macOS
    const output = execSync("df -k /", { timeout: 2000 }).toString();
    const line = output.trim().split('\n')[1].trim().split(/\s+/);
    const total = parseInt(line[1], 10) * 1024;
    const used = parseInt(line[2], 10) * 1024;
    const free = parseInt(line[3], 10) * 1024;
    return {
      totalBytes: total,
      freeBytes: free,
      usedBytes: used,
      usagePercent: Math.round((used / total) * 10000) / 100,
    };
  } catch (e) {
    return { error: e.message };
  }
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ');
}

function snapshotUptime() {
  const uptimeSeconds = Math.floor(os.uptime());
  return {
    uptimeSeconds,
    formatted: formatUptime(uptimeSeconds),
    processUptimeSeconds: process.uptime(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
  };
}

const cpuInfo = os.cpus();
const cache = { cpu: null, memory: null, disk: null, uptime: null };
let prevTotals = getCpuTotals();

function tick() {
  const timestamp = new Date().toISOString();
  const currTotals = getCpuTotals();
  const { idlePercent, usagePercent } = computeCpuPercents(prevTotals, currTotals);
  prevTotals = currTotals;

  cache.cpu = {
    type: 'cpu',
    timestamp,
    data: {
      model: cpuInfo[0].model,
      cores: cpuInfo.length,
      idlePercent,
      usagePercent,
      loadAverage: os.loadavg(),
    },
  };

  cache.memory = { type: 'memory', timestamp, data: snapshotMemory() };
  cache.disk = { type: 'disk', timestamp, data: snapshotDisk() };
  cache.uptime = { type: 'uptime', timestamp, data: snapshotUptime() };
}

const tickListeners = [];
export function onTick(fn) { tickListeners.push(fn); }

function runTick() {
  tick();
  for (const fn of tickListeners) fn(cache);
}

runTick();
setInterval(runTick, 1000).unref();

export function getSnapshot(type) { return cache[type] ?? null; }

export function getAllSnapshot() {
  const { cpu, memory, disk, uptime } = cache;
  return {
    timestamp: cpu.timestamp,
    cpu: cpu.data,
    memory: memory.data,
    disk: disk.data,
    uptime: uptime.data,
  };
}
