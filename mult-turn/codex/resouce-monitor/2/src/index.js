import { createServer } from 'http';
import express from 'express';
import {
  getLatestMetricSnapshot,
  getLatestSnapshot,
  VALID_METRIC_TYPES,
} from './metricsCollector.js';
import { attachWebSocketServer } from './webSocketServer.js';

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

app.use((req, res, next) => {
  res.type('application/json');
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/metrics', (req, res) => {
  res.status(200).json(getLatestSnapshot());
});

app.get('/metrics/:type', (req, res) => {
  const { type } = req.params;

  if (!VALID_METRIC_TYPES.includes(type)) {
    res.status(400).json({ error: `Invalid metric type: ${type}` });
    return;
  }

  res.status(200).json(getLatestMetricSnapshot(type));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

const server = createServer(app);

attachWebSocketServer(server);

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
