import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './auth.js';
import db from './db.js';

const clients = new Map();

const insertMessage = db.prepare(
  `INSERT INTO messages (user_id, username, content) VALUES (?, ?, ?)`
);
const getMessageById = db.prepare(
  `SELECT id, user_id AS userId, username, content, timestamp FROM messages WHERE id = ?`
);
const getHistory = db.prepare(
  `SELECT id, user_id AS userId, username, content, timestamp
   FROM messages ORDER BY id DESC LIMIT 50`
);

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const ws of clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function createWsServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'ws://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    let user;
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      user = { userId: decoded.userId, username: decoded.username };
    } catch {
      ws.close(4002, 'Invalid or expired token');
      return;
    }

    ws.user = user;
    clients.set(ws, user);

    const history = getHistory.all().reverse();
    ws.send(JSON.stringify({ type: 'history', messages: history }));

    ws.on('message', (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      if (parsed.type !== 'message' || !parsed.content || typeof parsed.content !== 'string' || !parsed.content.trim()) {
        ws.send(JSON.stringify({ type: 'error', message: 'Missing or empty content field' }));
        return;
      }

      const { userId, username } = ws.user;
      const result = insertMessage.run(userId, username, parsed.content);
      const saved = getMessageById.get(result.lastInsertRowid);

      broadcast({ type: 'message', ...saved });
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  return wss;
}

export { clients, createWsServer };
