import bcrypt from "bcryptjs";
import { Router } from "express";
import { signAuthToken } from "../middleware/auth.js";

const SALT_ROUNDS = 12;

const router = Router();

function validateRegistration(username, password) {
  if (!username) {
    return "Username is required";
  }

  if (username.length < 3) {
    return "Username must be at least 3 characters";
  }

  if (!password) {
    return "Password is required";
  }

  if (password.length < 6) {
    return "Password must be at least 6 characters";
  }

  return null;
}

function validateLogin(username, password) {
  if (!username) {
    return "Username is required";
  }

  if (!password) {
    return "Password is required";
  }

  return null;
}

router.post("/register", async (req, res) => {
  const { username, password } = req.body ?? {};
  const trimmedUsername = typeof username === "string" ? username.trim() : "";
  const passwordValue = typeof password === "string" ? password : "";
  const validationError = validateRegistration(trimmedUsername, passwordValue);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const db = req.app.locals.db;
  const passwordHash = await bcrypt.hash(passwordValue, SALT_ROUNDS);

  try {
    const result = db
      .prepare("INSERT INTO users (username, password) VALUES (?, ?)")
      .run(trimmedUsername, passwordHash);
    const userId = Number(result.lastInsertRowid);
    const token = signAuthToken({ userId, username: trimmedUsername });

    return res.status(201).json({
      token,
      userId,
      username: trimmedUsername,
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Username already taken" });
    }

    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  const trimmedUsername = typeof username === "string" ? username.trim() : "";
  const passwordValue = typeof password === "string" ? password : "";
  const validationError = validateLogin(trimmedUsername, passwordValue);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const db = req.app.locals.db;
  const user = db
    .prepare("SELECT id, username, password FROM users WHERE username = ?")
    .get(trimmedUsername);

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const passwordMatches = await bcrypt.compare(passwordValue, user.password);

  if (!passwordMatches) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const userId = user.id;
  const token = signAuthToken({ userId, username: user.username });

  return res.status(200).json({
    token,
    userId,
    username: user.username,
  });
});

export default router;
