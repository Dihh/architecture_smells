import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';

const databaseDirectory = path.resolve('data');
const databasePath = path.join(databaseDirectory, 'oidc-provider.sqlite');

export function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve(this);
    });
  });
}

export function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row);
    });
  });
}

export async function initializeDatabase() {
  fs.mkdirSync(databaseDirectory, { recursive: true });

  const db = new sqlite3.Database(databasePath);

  try {
    await run(db, 'PRAGMA foreign_keys = ON');

    await run(
      db,
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT NOT NULL
      )`,
    );

    await run(
      db,
      `CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT UNIQUE NOT NULL,
        client_secret TEXT NOT NULL,
        redirect_uris TEXT NOT NULL
      )`,
    );

    await run(
      db,
      `CREATE TABLE IF NOT EXISTS auth_codes (
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
      )`,
    );

    await run(
      db,
      `CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        access_token TEXT UNIQUE NOT NULL,
        client_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        scope TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
    );

    await seedDatabase(db);
  } catch (error) {
    await closeDatabase(db);
    throw error;
  }

  return db;
}

async function seedDatabase(db) {
  await run(
    db,
    `INSERT OR IGNORE INTO clients (client_id, client_secret, redirect_uris)
     VALUES (?, ?, ?)`,
    [
      'test-client',
      'test-secret',
      JSON.stringify([
        'http://localhost:8080/callback',
        'http://localhost:4001/callback',
      ]),
    ],
  );

  await run(
    db,
    `INSERT OR IGNORE INTO users (username, password, email)
     VALUES (?, ?, ?)`,
    ['testuser', 'password123', 'testuser@example.com'],
  );
}

export function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
