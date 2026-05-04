import express from 'express';
import http from 'http';
import { getCpuMetrics, getMemoryMetrics, getDiskMetrics, getUptimeMetrics, getFullMetrics } from './metrics.js';
import { setupWebSocket } from './websocket.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware to ensure JSON responses have the correct Content-Type
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Unified metrics endpoint
app.get('/metrics', (req, res) => {
  res.json(getFullMetrics());
});

// Dynamic metrics endpoint
app.get('/metrics/:type', (req, res) => {
  const { type } = req.params;
  const metricsMap = {
    cpu: getCpuMetrics,
    memory: getMemoryMetrics,
    disk: getDiskMetrics,
    uptime: getUptimeMetrics
  };

  if (metricsMap[type]) {
    res.json(metricsMap[type]());
  } else {
    res.status(400).json({ error: `Invalid metrics type: ${type}` });
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

setupWebSocket(server);
