import { Router } from 'express';
import { getCache } from '../metrics/collector.js';

const router = Router();
const VALID_TYPES = new Set(['cpu', 'memory', 'disk', 'uptime']);

router.get('/', (req, res) => {
  const cache = getCache();
  const allReady = VALID_TYPES.size === [...VALID_TYPES].filter(t => cache[t]).length;
  if (!allReady) return res.status(503).json({ error: 'Metrics not yet available' });

  const { cpu, memory, disk, uptime } = cache;
  res.json({
    timestamp: cpu.timestamp,
    cpu: cpu.data,
    memory: memory.data,
    disk: disk.data,
    uptime: uptime.data,
  });
});

router.get('/:type', (req, res) => {
  const { type } = req.params;
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: `Invalid metric type: "${type}"` });
  }
  const entry = getCache()[type];
  if (!entry) return res.status(503).json({ error: 'Metrics not yet available' });
  res.json(entry);
});

export default router;
