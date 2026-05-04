import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { signAuthToken } from './auth.js';
import { initializeDatabase } from './database.js';
import { attachWebSocketServer } from './websocket.js';

const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5273';
const PASSWORD_SALT_ROUNDS = 12;

const app = express();
const server = createServer(app);
let db;

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());

app.use((req, res, next) => {
  res.type('application/json');
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.post('/auth/register', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const hashedPassword = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
    const result = await db.run(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      username,
      hashedPassword
    );
    const userId = result.lastID;
    const token = signAuthToken({ userId, username });

    return res.status(201).json({ token, userId, username });
  } catch (error) {
    if (error?.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ error: 'Username already taken' });
    }

    return next(error);
  }
});

app.post('/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const user = await db.get(
      'SELECT id, username, password FROM users WHERE username = ?',
      username
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const userId = user.id;
    const token = signAuthToken({ userId, username: user.username });

    return res.status(200).json({ token, userId, username: user.username });
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((error, req, res, next) => {
  console.error(error);
  const status = error.status || error.statusCode || 500;
  const message = status >= 500 ? 'Internal server error' : error.message;

  res.status(status).json({ error: message });
});

try {
  db = await initializeDatabase();
  attachWebSocketServer(server, db);

  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
} catch (error) {
  console.error('Failed to initialize database:', error);
  process.exit(1);
}
