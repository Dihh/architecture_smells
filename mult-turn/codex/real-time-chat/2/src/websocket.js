import { WebSocket, WebSocketServer } from 'ws';
import { verifyAuthToken } from './auth.js';

export const connectedClients = new Set();

function serializeMessage(row) {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    content: row.content,
    timestamp: row.timestamp
  };
}

function sendJson(ws, payload) {
  ws.send(JSON.stringify(payload));
}

function sendError(ws, message) {
  sendJson(ws, { type: 'error', message });
}

function broadcastMessage(payload) {
  const message = JSON.stringify(payload);

  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function closeUnauthenticatedConnection(webSocketServer, request, socket, head, code) {
  webSocketServer.handleUpgrade(request, socket, head, (ws) => {
    ws.close(code);
  });
}

async function sendMessageHistory(ws, db) {
  const rows = await db.all(`
    SELECT id, user_id, username, content, timestamp
    FROM (
      SELECT id, user_id, username, content, timestamp
      FROM messages
      ORDER BY id DESC
      LIMIT 50
    )
    ORDER BY id ASC
  `);

  sendJson(ws, {
    type: 'history',
    messages: rows.map(serializeMessage)
  });
}

async function handleClientMessage(ws, db, data) {
  let payload;

  try {
    payload = JSON.parse(data.toString());
  } catch (error) {
    sendError(ws, 'Invalid JSON');
    return;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    sendError(ws, 'Malformed message payload');
    return;
  }

  if (payload.type !== 'message') {
    sendError(ws, 'Malformed message payload');
    return;
  }

  if (typeof payload.content !== 'string' || payload.content.trim().length === 0) {
    sendError(ws, 'Message content is required');
    return;
  }

  try {
    const result = await db.run(
      'INSERT INTO messages (user_id, username, content) VALUES (?, ?, ?)',
      ws.user.userId,
      ws.user.username,
      payload.content
    );
    const row = await db.get(
      'SELECT id, user_id, username, content, timestamp FROM messages WHERE id = ?',
      result.lastID
    );

    broadcastMessage({
      type: 'message',
      ...serializeMessage(row)
    });
  } catch (error) {
    console.error(error);
    sendError(ws, 'Failed to process message');
  }
}

export function attachWebSocketServer(server, db) {
  const webSocketServer = new WebSocketServer({ noServer: true });

  webSocketServer.on('connection', async (ws) => {
    try {
      await sendMessageHistory(ws, db);
    } catch (error) {
      console.error(error);
      sendError(ws, 'Failed to load message history');
    }

    ws.on('message', (data) => {
      handleClientMessage(ws, db, data);
    });
  });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      closeUnauthenticatedConnection(webSocketServer, request, socket, head, 4001);
      return;
    }

    let user;

    try {
      user = verifyAuthToken(token);
    } catch (error) {
      closeUnauthenticatedConnection(webSocketServer, request, socket, head, 4002);
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (ws) => {
      ws.user = user;
      connectedClients.add(ws);

      ws.on('close', () => {
        connectedClients.delete(ws);
      });

      webSocketServer.emit('connection', ws, request);
    });
  });

  return webSocketServer;
}
