import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createServer } from "http";
import { WebSocketServer } from "ws";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5273";
const DB_PATH = process.env.DB_PATH ?? "./chat.db";
const JWT_SECRET = process.env.JWT_SECRET ?? "default-secret";
const SQLite3 = sqlite3.verbose();

function initDb() {
  return new Promise((resolve, reject) => {
    const db = new SQLite3.Database(DB_PATH, (err) => {
      if (err) {
        return reject(err);
      }
      db.serialize(() => {
        db.run(
          `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
          )`,
          (createUserErr) => {
            if (createUserErr) {
              return reject(createUserErr);
            }
            db.run(
              `CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
              )`,
              (createMessagesErr) => {
                if (createMessagesErr) {
                  return reject(createMessagesErr);
                }
                resolve(db);
              }
            );
          }
        );
      });
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) return reject(err);
      resolve(hash);
    });
  });
}

function comparePassword(password, hash) {
  return new Promise((resolve, reject) => {
    bcrypt.compare(password, hash, (err, isMatch) => {
      if (err) return reject(err);
      resolve(isMatch);
    });
  });
}

function createToken(userId, username) {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: "1h" });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

const db = await initDb();

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  })
);

app.use(express.json());

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.setHeader("Content-Type", "application/json");
    return originalJson(body);
  };
  next();
});

app.post("/auth/register", async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }
  if (typeof username !== "string" || username.length < 3) {
    return res.status(400).json({ error: "Username must be at least 3 characters long" });
  }
  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters long" });
  }

  try {
    const existingUser = await dbGet(db, "SELECT id FROM users WHERE username = ?", [username]);
    if (existingUser) {
      return res.status(409).json({ error: "Username already taken" });
    }

    const hashedPassword = await hashPassword(password);
    const result = await dbRun(db, "INSERT INTO users (username, password) VALUES (?, ?)", [username, hashedPassword]);
    const userId = result.lastID;
    const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: "1h" });

    return res.status(201).json({ token, userId, username });
  } catch (error) {
    console.error(error);
    if (error?.message?.includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: "Username already taken" });
    }
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }
  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }

  try {
    const user = await dbGet(db, "SELECT id, username, password FROM users WHERE username = ?", [username]);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const passwordMatches = await comparePassword(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = createToken(user.id, user.username);
    return res.status(200).json({ token, userId: user.id, username: user.username });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

const server = createServer(app);
const clients = new Set();
const wss = new WebSocketServer({ noServer: true });

function sendJson(ws, payload) {
  ws.send(JSON.stringify(payload));
}

function broadcast(payload) {
  const serialized = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(serialized);
    }
  }
}

wss.on("connection", async (ws) => {
  clients.add(ws);

  ws.on("close", () => {
    clients.delete(ws);
  });

  try {
    const history = await dbAll(
      db,
      `SELECT id, user_id AS userId, username, content, timestamp
       FROM (
         SELECT id, user_id, username, content, timestamp
         FROM messages
         ORDER BY id DESC
         LIMIT 50
       )
       ORDER BY id ASC`
    );

    sendJson(ws, { type: "history", messages: history });
  } catch (error) {
    console.error("Failed to load history:", error);
    sendJson(ws, { type: "error", message: "Failed to load message history" });
  }

  ws.on("message", async (data) => {
    let parsed;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      sendJson(ws, { type: "error", message: "Invalid JSON payload" });
      return;
    }

    if (!parsed || parsed.type !== "message" || typeof parsed.content !== "string") {
      sendJson(ws, { type: "error", message: "Malformed message payload" });
      return;
    }

    const content = parsed.content.trim();
    if (!content) {
      sendJson(ws, { type: "error", message: "Message content must not be empty" });
      return;
    }

    if (!ws.user || typeof ws.user.userId !== "number" || typeof ws.user.username !== "string") {
      sendJson(ws, { type: "error", message: "Unauthorized" });
      return;
    }

    try {
      const result = await dbRun(
        db,
        "INSERT INTO messages (user_id, username, content) VALUES (?, ?, ?)",
        [ws.user.userId, ws.user.username, content]
      );
      const saved = await dbGet(db, "SELECT id, user_id AS userId, username, content, timestamp FROM messages WHERE id = ?", [result.lastID]);
      if (!saved) {
        throw new Error("Saved message not found");
      }
      broadcast({
        type: "message",
        id: saved.id,
        userId: saved.userId,
        username: saved.username,
        content: saved.content,
        timestamp: saved.timestamp,
      });
    } catch (error) {
      console.error("Failed to process message:", error);
      sendJson(ws, { type: "error", message: "Failed to save message" });
    }
  });
});

server.on("upgrade", (request, socket, head) => {
  const requestUrl = new URL(request.url ?? "", `http://${request.headers.host}`);
  const token = requestUrl.searchParams.get("token");

  wss.handleUpgrade(request, socket, head, (ws) => {
    if (!token) {
      ws.close(4001);
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      ws.user = { userId: decoded.userId, username: decoded.username };
      wss.emit("connection", ws, request);
    } catch {
      ws.close(4002);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`SQLite database path: ${DB_PATH}`);
});
