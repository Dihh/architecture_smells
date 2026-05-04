import { WebSocketServer } from 'ws';
import { verifyToken } from './middleware/auth.js';
import { getDB } from './db.js';
import url from 'url';

/**
 * WebSocket Registry
 * Keeps track of all authenticated connected clients.
 */
const clients = new Map();

/**
 * Initialize WebSocket Server
 * @param {http.Server} server - The HTTP server to attach the WebSocket server to.
 */
export const initSocketServer = (server) => {
  const wss = new WebSocketServer({ noServer: true });

  // Handle the HTTP upgrade to WebSocket
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  // Handle new connections
  wss.on('connection', async (ws, request) => {
    const parsedUrl = url.parse(request.url, true);
    const token = parsedUrl.query.token;

    // 1. Check if token is present
    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    // 2. Validate the token
    const decoded = verifyToken(token);
    if (!decoded) {
      ws.close(4002, 'Invalid or expired token');
      return;
    }

    // Store user info on the connection object
    ws.user = {
      userId: decoded.userId,
      username: decoded.username
    };

    // Add to registry
    clients.set(ws, ws.user);
    console.log(`🔌 Client connected: ${ws.user.username} (${clients.size} total)`);

    try {
      const db = getDB();

      // 3. Send Message History
      // Last 50 messages, ordered oldest first
      const messages = await db.all(`
        SELECT id, user_id as userId, username, content, timestamp 
        FROM (SELECT * FROM messages ORDER BY timestamp DESC LIMIT 50)
        ORDER BY timestamp ASC
      `);

      ws.send(JSON.stringify({
        type: "history",
        messages
      }));

      // 4. Handle incoming messages from client
      ws.on('message', async (data) => {
        let payload;
        try {
          payload = JSON.parse(data);
        } catch (err) {
          return ws.send(JSON.stringify({ type: "error", message: "Invalid JSON received" }));
        }

        if (payload.type !== 'message') {
          return ws.send(JSON.stringify({ type: "error", message: "Unsupported message type" }));
        }

        if (!payload.content || payload.content.trim() === '') {
          return ws.send(JSON.stringify({ type: "error", message: "Message content cannot be empty" }));
        }

        try {
          // Save to database
          const result = await db.run(
            'INSERT INTO messages (user_id, username, content) VALUES (?, ?, ?)',
            [ws.user.userId, ws.user.username, payload.content]
          );

          // Read back the saved row
          const savedMessage = await db.get(
            'SELECT id, user_id as userId, username, content, timestamp FROM messages WHERE id = ?',
            [result.lastID]
          );

          // Broadcast to ALL connected authenticated clients
          const broadcastPayload = JSON.stringify({
            type: "message",
            ...savedMessage
          });

          clients.forEach((user, client) => {
            if (client.readyState === 1) { // 1 = OPEN
              client.send(broadcastPayload);
            }
          });

        } catch (dbErr) {
          console.error('Database Error during message handling:', dbErr);
          ws.send(JSON.stringify({ type: "error", message: "Failed to save message" }));
        }
      });

    } catch (err) {
      console.error('Connection initialization error:', err);
      ws.send(JSON.stringify({ type: "error", message: "Failed to load history" }));
    }

    // Handle disconnection
    ws.on('close', (code, reason) => {
      if (ws.user) {
        clients.delete(ws);
        console.log(`🔌 Client disconnected: ${ws.user.username} (Code: ${code}) (${clients.size} remaining)`);
      }
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`WebSocket Error for ${ws.user?.username || 'unknown'}:`, error);
      if (ws.user) {
        clients.delete(ws);
      }
    });
  });

  return wss;
};

/**
 * Get all connected clients
 */
export const getConnectedClients = () => clients;
