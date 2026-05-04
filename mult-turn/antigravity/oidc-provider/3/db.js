import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export let db = null;

export async function initDb() {
  db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });

  await db.exec(`
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

  // Seed data
  const testClient = await db.get('SELECT id FROM clients WHERE client_id = ?', 'test-client');
  if (!testClient) {
    await db.run(
      'INSERT INTO clients (client_id, client_secret, redirect_uris) VALUES (?, ?, ?)',
      'test-client',
      'test-secret',
      JSON.stringify(['http://localhost:8080/callback', 'http://localhost:4001/callback'])
    );
  }

  const testUser = await db.get('SELECT id FROM users WHERE username = ?', 'testuser');
  if (!testUser) {
    await db.run(
      'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
      'testuser',
      'password123',
      'testuser@example.com'
    );
  }

  return db;
}
