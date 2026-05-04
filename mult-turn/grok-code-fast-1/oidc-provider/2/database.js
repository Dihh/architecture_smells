import sqlite3 from 'sqlite3';
import { promisify } from 'util';

const db = new sqlite3.Database('./oidc.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT UNIQUE NOT NULL,
    client_secret TEXT NOT NULL,
    redirect_uris TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS auth_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    client_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    redirect_uri TEXT NOT NULL,
    scope TEXT NOT NULL,
    code_challenge TEXT,
    code_challenge_method TEXT,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    access_token TEXT UNIQUE NOT NULL,
    client_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    scope TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`);

  // Seed data
  db.get("SELECT COUNT(*) as count FROM users WHERE username = 'testuser'", (err, row) => {
    if (err) console.error(err);
    else if (row.count === 0) {
      db.run("INSERT INTO users (username, password, email) VALUES ('testuser', 'password123', 'testuser@example.com')");
    }
  });

  db.get("SELECT COUNT(*) as count FROM clients WHERE client_id = 'test-client'", (err, row) => {
    if (err) console.error(err);
    else if (row.count === 0) {
      db.run("INSERT INTO clients (client_id, client_secret, redirect_uris) VALUES ('test-client', 'test-secret', '[\"http://localhost:8080/callback\", \"http://localhost:4001/callback\"]')");
    }
  });
});

export default db;