import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from './db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';
const SALT_ROUNDS = 10;

router.post('/register', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (!password) return res.status(400).json({ error: 'Password is required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const hashed = await bcrypt.hash(password, SALT_ROUNDS);

  try {
    const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hashed);
    const userId = result.lastInsertRowid;
    const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '7d' });
    return res.status(201).json({ token, userId, username });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Username already taken' });
    }
    throw err;
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (!password) return res.status(400).json({ error: 'Password is required' });

  const user = db.prepare('SELECT id, username, password FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  const userId = user.id;
  const token = jwt.sign({ userId, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  return res.status(200).json({ token, userId, username: user.username });
});

export { JWT_SECRET };
export default router;
