import Database from 'better-sqlite3';

const DB_PATH = './oidc.db';

export function initializeDatabase() {
  const db = new Database(DB_PATH);

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      username  TEXT UNIQUE NOT NULL,
      password  TEXT NOT NULL,
      email     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clients (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id      TEXT UNIQUE NOT NULL,
      client_secret  TEXT NOT NULL,
      redirect_uris  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_codes (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      code                  TEXT UNIQUE NOT NULL,
      client_id             TEXT NOT NULL,
      user_id               INTEGER NOT NULL,
      redirect_uri          TEXT NOT NULL,
      scope                 TEXT NOT NULL,
      code_challenge        TEXT,
      code_challenge_method TEXT,
      expires_at            INTEGER NOT NULL,
      used                  INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      access_token  TEXT UNIQUE NOT NULL,
      client_id     TEXT NOT NULL,
      user_id       INTEGER NOT NULL,
      scope         TEXT NOT NULL,
      expires_at    INTEGER NOT NULL
    );
  `);

  // Seed data if not present
  const clientExists = db.prepare('SELECT id FROM clients WHERE client_id = ?').get('test-client');
  if (!clientExists) {
    db.prepare('INSERT INTO clients (client_id, client_secret, redirect_uris) VALUES (?, ?, ?)').run(
      'test-client',
      'test-secret',
      JSON.stringify(['http://localhost:8080/callback', 'http://localhost:4001/callback'])
    );
  }

  const userExists = db.prepare('SELECT id FROM users WHERE username = ?').get('testuser');
  if (!userExists) {
    db.prepare('INSERT INTO users (username, password, email) VALUES (?, ?, ?)').run(
      'testuser',
      'password123',
      'testuser@example.com'
    );
  }

  return db;
}