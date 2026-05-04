import { WebSocketServer } from 'ws';
import { verifyToken } from './auth.js';
import { db } from './db.js';

export const authenticatedClients = new Set();

function sendJson(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendError(ws, message) {
  sendJson(ws, { type: 'error', message });
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of authenticatedClients) {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  }
}

function sendHistory(ws) {
  db.all(
    `SELECT id, user_id AS userId, username, content, timestamp
     FROM messages
     ORDER BY id DESC
     LIMIT 50`,
    (err, rows) => {
      if (err) {
        sendError(ws, 'Failed to load message history');
        return;
      }

      const messages = rows.reverse();
      sendJson(ws, { type: 'history', messages });
    },
  );
}

function handleIncomingMessage(ws, rawData) {
  let payload;
  try {
    payload = JSON.parse(rawData.toString());
  } catch (err) {
    sendError(ws, 'Invalid JSON');
    return;
  }

  if (!payload || payload.type !== 'message' || typeof payload.content !== 'string') {
    sendError(ws, 'Malformed message payload');
    return;
  }

  const content = payload.content.trim();
  if (!content) {
    sendError(ws, 'Message content is required');
    return;
  }

  db.run(
    'INSERT INTO messages (user_id, username, content) VALUES (?, ?, ?)',
    [ws.user.userId, ws.user.username, content],
    function (err) {
      if (err) {
        sendError(ws, 'Failed to save message');
        return;
      }

      const insertedId = this.lastID;
      db.get(
        `SELECT id, user_id AS userId, username, content, timestamp
         FROM messages
         WHERE id = ?`,
        [insertedId],
        (getErr, row) => {
          if (getErr || !row) {
            sendError(ws, 'Failed to retrieve saved message');
            return;
          }

          broadcast({
            type: 'message',
            id: row.id,
            userId: row.userId,
            username: row.username,
            content: row.content,
            timestamp: row.timestamp,
          });
        },
      );
    },
  );
}

export function createWebSocketServer(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!token) {
        ws.close(4001);
        return;
      }

      let decoded;
      try {
        decoded = verifyToken(token);
      } catch (err) {
        ws.close(4002);
        return;
      }

      ws.user = {
        userId: decoded.userId,
        username: decoded.username,
      };

      authenticatedClients.add(ws);
      ws.on('close', () => {
        authenticatedClients.delete(ws);
      });

      sendHistory(ws);
      ws.on('message', (message) => handleIncomingMessage(ws, message));

      wss.emit('connection', ws, req);
    });
  });

  return wss;
}
