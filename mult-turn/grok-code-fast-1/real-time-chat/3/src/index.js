import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';

const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3');

const app = express();

const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5273';
const DB_PATH = process.env.DB_PATH || './chat.db';
const JWT_SECRET = process.env.JWT_SECRET || 'defaultsecret';

// Initialize database
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL,
    username  TEXT NOT NULL,
    content   TEXT NOT NULL,
    timestamp TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )`);
});

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());

// Auth middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { userId: decoded.userId, username: decoded.username };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/auth/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters long' });
  }
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  db.get('SELECT id FROM users WHERE username = ?', [username], async (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (row) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        const userId = this.lastID;
        const token = jwt.sign({ userId, username }, JWT_SECRET);
        res.status(201).json({ token, userId, username });
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  db.get('SELECT id, password FROM users WHERE username = ?', [username], async (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    try {
      const isValid = await bcrypt.compare(password, row.password);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const token = jwt.sign({ userId: row.id, username }, JWT_SECRET);
      res.json({ token, userId: row.id, username });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// WebSocket server
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close(4001);
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    ws.user = { userId: decoded.userId, username: decoded.username };
    clients.add(ws);

    // Send history
    db.all('SELECT id, user_id as userId, username, content, timestamp FROM messages ORDER BY id DESC LIMIT 50', (err, rows) => {
      if (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to load history' }));
        return;
      }
      rows.reverse(); // oldest first
      ws.send(JSON.stringify({ type: 'history', messages: rows }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type !== 'message' || !msg.content || typeof msg.content !== 'string' || msg.content.trim() === '') {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
          return;
        }

        db.run('INSERT INTO messages (user_id, username, content) VALUES (?, ?, ?)', [ws.user.userId, ws.user.username, msg.content], function(err) {
          if (err) {
            ws.send(JSON.stringify({ type: 'error', message: 'Database error' }));
            return;
          }
          const messageId = this.lastID;
          db.get('SELECT id, user_id as userId, username, content, timestamp FROM messages WHERE id = ?', [messageId], (err, row) => {
            if (err) {
              ws.send(JSON.stringify({ type: 'error', message: 'Database error' }));
              return;
            }
            const broadcastMsg = {
              type: 'message',
              id: row.id,
              userId: row.userId,
              username: row.username,
              content: row.content,
              timestamp: row.timestamp
            };
            clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(broadcastMsg));
              }
            });
          });
        });
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  } catch (error) {
    ws.close(4002);
  }
});