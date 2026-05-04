import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getDB } from '../db.js';

const router = express.Router();

// JWT Secret should ideally be in environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'premium-secret-key-123';

/**
 * POST /auth/register
 * Registers a new user.
 */
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  // 1. Validation
  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: "Username must be at least 3 characters long" });
  }
  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters long" });
  }

  try {
    const db = getDB();

    // 2. Check for existing username (Conflict)
    const existingUser = await db.get('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(409).json({ error: "Username already taken" });
    }

    // 3. Hash the password for security
    // Using a salt rounds of 10 for a good balance between security and performance
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Save the user to the database
    const result = await db.run(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hashedPassword]
    );

    const userId = result.lastID;

    // 5. Generate a JWT for the new user
    // We encode the userId and username as requested
    const token = jwt.sign(
      { userId, username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // 6. Return the success response
    return res.status(201).json({
      token,
      userId,
      username
    });

  } catch (error) {
    console.error('Registration Error:', error);
    
    // Check if it's a unique constraint violation (just in case of race conditions)
    if (error.message && error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: "Username already taken" });
    }

    return res.status(500).json({ error: "An internal server error occurred during registration" });
  }
});

/**
 * POST /auth/login
 * Authenticates a user and returns a JWT.
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // 1. Validation
  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }
  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }

  try {
    const db = getDB();

    // 2. Find the user by username
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // 3. Verify the password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // 4. Generate a JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // 5. Return the success response
    return res.status(200).json({
      token,
      userId: user.id,
      username: user.username
    });

  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({ error: "An internal server error occurred during login" });
  }
});

export default router;
