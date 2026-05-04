import http from 'http';
import express from 'express';
import { startCollector } from './metrics/collector.js';
import metricsRouter from './routes/metrics.js';
import { createWsServer } from './ws/server.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(express.json());

startCollector();

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/metrics', metricsRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

const server = http.createServer(app);
createWsServer(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
