import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import url from 'url';
import { run, get, all } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// Registry of connected clients
const clients = new Set();

export const initWebSocket = (server) => {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const parsedUrl = url.parse(request.url, true);
    const token = parsedUrl.query.token;

    wss.handleUpgrade(request, socket, head, (ws) => {
      if (!token) {
        ws.close(4001);
        return;
      }

      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        ws.user = {
          userId: decoded.userId,
          username: decoded.username
        };
        wss.emit('connection', ws, request);
      } catch (err) {
        ws.close(4002);
      }
    });
  });

  wss.on('connection', async (ws) => {
    console.log(`User connected: ${ws.user.username}`);
    clients.add(ws);

    // 1. Send message history (last 50 messages, oldest first)
    try {
      const history = await all(
        'SELECT * FROM (SELECT * FROM messages ORDER BY id DESC LIMIT 50) ORDER BY id ASC'
      );
      ws.send(JSON.stringify({ type: 'history', messages: history }));
    } catch (err) {
      console.error('Error fetching history:', err.message);
    }

    ws.on('message', async (data) => {
      let payload;
      try {
        payload = JSON.parse(data);
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
        return;
      }

      if (payload.type !== 'message' || !payload.content || payload.content.trim() === '') {
        ws.send(JSON.stringify({ type: 'error', error: 'Content is required' }));
        return;
      }

      try {
        // 2. Save message to database
        const { lastID } = await run(
          'INSERT INTO messages (user_id, username, content) VALUES (?, ?, ?)',
          [ws.user.userId, ws.user.username, payload.content]
        );

        // 3. Read back the saved row
        const savedMessage = await get('SELECT * FROM messages WHERE id = ?', [lastID]);

        // 4. Broadcast to all authenticated clients
        const broadcastPayload = JSON.stringify({
          type: 'message',
          ...savedMessage
        });

        for (const client of clients) {
          if (client.readyState === 1) { // 1 = WebSocket.OPEN
            client.send(broadcastPayload);
          }
        }
      } catch (err) {
        console.error('Error processing message:', err.message);
        ws.send(JSON.stringify({ type: 'error', error: 'Failed to save message' }));
      }
    });

    ws.on('close', () => {
      console.log(`User disconnected: ${ws.user?.username || 'Unknown'}`);
      clients.delete(ws);
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error for ${ws.user?.username || 'Unknown'}:`, err.message);
      clients.delete(ws);
    });
  });

  return wss;
};

export { clients };
