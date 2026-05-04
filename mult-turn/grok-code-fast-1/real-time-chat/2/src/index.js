import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5273';
const DB_PATH = process.env.DB_PATH || './chat.db';
const JWT_SECRET = process.env.JWT_SECRET || 'defaultsecret';

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    next();
  });
};

const clients = new Set();

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

app.post('/auth/register', (req, res) => {
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

  db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (row) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    bcrypt.hash(password, 10, (err, hash) => {
      if (err) {
        return res.status(500).json({ error: 'Error hashing password' });
      }

      db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Error creating user' });
        }

        const userId = this.lastID;
        const token = jwt.sign({ userId, username }, JWT_SECRET);

        res.status(201).json({ token, userId, username });
      });
    });
  });
});

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  db.get('SELECT id, password FROM users WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    bcrypt.compare(password, row.password, (err, match) => {
      if (err) {
        return res.status(500).json({ error: 'Error verifying password' });
      }
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign({ userId: row.id, username }, JWT_SECRET);
      res.json({ token, userId: row.id, username });
    });
  });
});

app.get('/health', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close(4001);
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      ws.close(4002);
      return;
    }

    ws.user = user;
    clients.add(ws);

    // Send message history
    db.all('SELECT id, user_id as userId, username, content, timestamp FROM messages ORDER BY id ASC LIMIT 50', (err, rows) => {
      if (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to load history' }));
        return;
      }
      ws.send(JSON.stringify({ type: 'history', messages: rows }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type !== 'message' || !msg.content || typeof msg.content !== 'string' || msg.content.trim() === '') {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
          return;
        }

        db.run('INSERT INTO messages (user_id, username, content) VALUES (?, ?, ?)', [ws.user.userId, ws.user.username, msg.content], function(err) {
          if (err) {
            ws.send(JSON.stringify({ type: 'error', message: 'Failed to save message' }));
            return;
          }

          const messageId = this.lastID;
          db.get('SELECT id, timestamp FROM messages WHERE id = ?', [messageId], (err, row) => {
            if (err) {
              ws.send(JSON.stringify({ type: 'error', message: 'Failed to retrieve message' }));
              return;
            }

            const broadcastMsg = {
              type: 'message',
              id: row.id,
              userId: ws.user.userId,
              username: ws.user.username,
              content: msg.content,
              timestamp: row.timestamp
            };

            clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(broadcastMsg));
              }
            });
          });
        });
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });
});