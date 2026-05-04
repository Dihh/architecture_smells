import WebSocket, { WebSocketServer } from "ws";
import { verifyAuthToken } from "./middleware/auth.js";

export const connectedClients = new Set();

function toMessage(row) {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    content: row.content,
    timestamp: row.timestamp,
  };
}

function sendJson(ws, payload) {
  ws.send(JSON.stringify(payload));
}

function sendError(ws, message) {
  sendJson(ws, { type: "error", message });
}

function loadMessageHistory(db) {
  return db
    .prepare(
      `
        SELECT id, user_id, username, content, timestamp
        FROM (
          SELECT id, user_id, username, content, timestamp
          FROM messages
          ORDER BY id DESC
          LIMIT 50
        )
        ORDER BY id ASC
      `,
    )
    .all()
    .map(toMessage);
}

function saveMessage(db, user, content) {
  const result = db
    .prepare(
      `
        INSERT INTO messages (user_id, username, content, timestamp)
        VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      `,
    )
    .run(user.userId, user.username, content);

  const row = db
    .prepare(
      `
        SELECT id, user_id, username, content, timestamp
        FROM messages
        WHERE id = ?
      `,
    )
    .get(result.lastInsertRowid);

  return toMessage(row);
}

function broadcastMessage(message) {
  const payload = JSON.stringify({
    type: "message",
    ...message,
  });

  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function handleClientMessage(ws, db, rawMessage) {
  let payload;

  try {
    payload = JSON.parse(rawMessage.toString());
  } catch {
    sendError(ws, "Invalid JSON");
    return;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    sendError(ws, "Malformed message payload");
    return;
  }

  if (payload.type !== "message") {
    sendError(ws, "Malformed message payload");
    return;
  }

  if (typeof payload.content !== "string" || payload.content.trim().length === 0) {
    sendError(ws, "Message content is required");
    return;
  }

  const message = saveMessage(db, ws.user, payload.content.trim());
  broadcastMessage(message);
}

export function initializeWebSocketServer(server, db) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get("token");

    wss.handleUpgrade(request, socket, head, (ws) => {
      if (!token) {
        ws.close(4001, "Authentication required");
        return;
      }

      let user;

      try {
        user = verifyAuthToken(token);
      } catch {
        ws.close(4002, "Invalid or expired token");
        return;
      }

      ws.user = user;
      connectedClients.add(ws);

      sendJson(ws, {
        type: "history",
        messages: loadMessageHistory(db),
      });

      ws.on("message", (rawMessage) => {
        handleClientMessage(ws, db, rawMessage);
      });

      ws.on("close", () => {
        connectedClients.delete(ws);
      });

      wss.emit("connection", ws, request);
    });
  });

  return wss;
}
