import http from 'http';
import express from 'express';
import { getSnapshot, getAllSnapshot } from './metrics.js';
import { createWsServer } from './ws.js';

const app = express();
const PORT = process.env.PORT ?? 3001;
const VALID_TYPES = new Set(['cpu', 'memory', 'disk', 'uptime']);

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/metrics', (req, res) => {
  res.json(getAllSnapshot());
});

app.get('/metrics/:type', (req, res) => {
  const { type } = req.params;
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: `Invalid metric type: "${type}"` });
  }
  res.json(getSnapshot(type));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const server = http.createServer(app);
createWsServer(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
