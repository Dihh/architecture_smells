import http from 'http';
import express from 'express';
import cors from 'cors';
import { initializeDatabase } from './db.js';
import { registerAuthRoutes } from './auth.js';
import { createWebSocketServer } from './ws.js';

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5273';

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.type('application/json');
    return originalJson(body);
  };
  next();
});

await initializeDatabase();
registerAuthRoutes(app);
createWebSocketServer(server);

app.get('/health', (req, res) => {
  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
