import http from 'http';
import { WebSocketServer } from 'ws';
import { URL } from 'url';
import express from 'express';
import cors from 'cors';
import db from './db.js';
import authRouter from './routes/auth.js';
import { verifyToken } from './middleware/auth.js';

const PORT = process.env.PORT ?? 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5273';

const app = express();

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());

app.use('/auth', authRouter);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

// Map<ws, { userId, username }>
export const clients = new Map();

const getHistory = db.prepare(`
  SELECT id, user_id AS userId, username, content, timestamp
  FROM messages ORDER BY id DESC LIMIT 50
`);

const insertMessage = db.prepare(`
  INSERT INTO messages (user_id, username, content)
  VALUES (@userId, @username, @content)
`);

const getMessageById = db.prepare(`
  SELECT id, user_id AS userId, username, content, timestamp
  FROM messages WHERE id = ?
`);

wss.on('connection', (ws, user) => {
  clients.set(ws, user);

  const history = getHistory.all().reverse();
  ws.send(JSON.stringify({ type: 'history', messages: history }));

  ws.on('message', (raw) => {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    if (parsed.type !== 'message' || !parsed.content || typeof parsed.content !== 'string' || !parsed.content.trim()) {
      ws.send(JSON.stringify({ type: 'error', message: 'Missing or empty content field' }));
      return;
    }

    const { lastInsertRowid } = insertMessage.run({ userId: user.userId, username: user.username, content: parsed.content });
    const saved = getMessageById.get(lastInsertRowid);

    const payload = JSON.stringify({ type: 'message', ...saved });
    for (const client of clients.keys()) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});

server.on('upgrade', (req, socket, head) => {
  const { searchParams } = new URL(req.url, 'http://localhost');
  const token = searchParams.get('token');

  if (!token) {
    wss.handleUpgrade(req, socket, head, (ws) => ws.close(4001));
    return;
  }

  let user;
  try {
    const payload = verifyToken(token);
    user = { userId: payload.userId, username: payload.username };
  } catch {
    wss.handleUpgrade(req, socket, head, (ws) => ws.close(4002));
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, user);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
