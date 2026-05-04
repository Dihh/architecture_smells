import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const TOKEN_EXPIRATION = '1h';

function jsonError(res, message, status = 400) {
  return res.status(status).json({ error: message });
}

function signToken(userId, username) {
  return jwt.sign({ userId, username }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRATION,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonError(res, 'Unauthorized', 401);
  }

  const token = authHeader.slice(7).trim();
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err || !decoded || !decoded.userId || !decoded.username) {
      return jsonError(res, 'Unauthorized', 401);
    }

    req.user = {
      userId: decoded.userId,
      username: decoded.username,
    };
    next();
  });
}

export function registerAuthRoutes(app) {
  app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body || {};

    if (!username) {
      return jsonError(res, 'username is required', 400);
    }

    if (typeof username !== 'string' || username.length < 3) {
      return jsonError(res, 'username must be at least 3 characters', 400);
    }

    if (!password) {
      return jsonError(res, 'password is required', 400);
    }

    if (typeof password !== 'string' || password.length < 6) {
      return jsonError(res, 'password must be at least 6 characters', 400);
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      db.run(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        [username, hashedPassword],
        function (err) {
          if (err) {
            if (err.code === 'SQLITE_CONSTRAINT' && err.message.includes('UNIQUE')) {
              return jsonError(res, 'Username already taken', 409);
            }
            return jsonError(res, 'Internal server error', 500);
          }

          const userId = this.lastID;
          const token = signToken(userId, username);

          return res.status(201).json({
            token,
            userId,
            username,
          });
        },
      );
    } catch (error) {
      return jsonError(res, 'Internal server error', 500);
    }
  });

  app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body || {};

    if (!username) {
      return jsonError(res, 'username is required', 400);
    }

    if (!password) {
      return jsonError(res, 'password is required', 400);
    }

    db.get(
      'SELECT id, username, password FROM users WHERE username = ?',
      [username],
      async (err, row) => {
        if (err) {
          return jsonError(res, 'Internal server error', 500);
        }

        if (!row) {
          return jsonError(res, 'Invalid credentials', 401);
        }

        const passwordMatches = await bcrypt.compare(password, row.password);
        if (!passwordMatches) {
          return jsonError(res, 'Invalid credentials', 401);
        }

        const token = signToken(row.id, row.username);
        return res.status(200).json({
          token,
          userId: row.id,
          username: row.username,
        });
      },
    );
  });
}
