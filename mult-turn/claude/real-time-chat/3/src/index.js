import http from 'http';
import express from 'express';
import cors from 'cors';
import './db.js';
import authRouter from './auth.js';
import { createWsServer } from './ws.js';

const PORT = process.env.PORT ?? 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5273';

const app = express();

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());

app.use('/auth', authRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const server = http.createServer(app);
createWsServer(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
