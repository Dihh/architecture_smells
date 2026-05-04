import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, 'data');
const databaseFile = path.resolve(dataDir, 'database.sqlite');

function ensureDataDirectory() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function openDatabase() {
  ensureDataDirectory();
  return new sqlite3.Database(databaseFile);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve(this);
      }
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export async function getClientById(db, clientId) {
  const row = await get(db, 'SELECT * FROM clients WHERE client_id = ?', [clientId]);
  if (!row) return null;

  return {
    ...row,
    redirect_uris: JSON.parse(row.redirect_uris)
  };
}

export async function getUserByUsername(db, username) {
  return await get(db, 'SELECT * FROM users WHERE username = ?', [username]);
}

export async function insertAuthCode(db, authCode) {
  const sql = `INSERT INTO auth_codes (
    code,
    client_id,
    user_id,
    redirect_uri,
    scope,
    code_challenge,
    code_challenge_method,
    expires_at,
    used
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const params = [
    authCode.code,
    authCode.client_id,
    authCode.user_id,
    authCode.redirect_uri,
    authCode.scope,
    authCode.code_challenge,
    authCode.code_challenge_method,
    authCode.expires_at,
    0
  ];

  await run(db, sql, params);
}

export async function getAuthCode(db, code) {
  return await get(db, 'SELECT * FROM auth_codes WHERE code = ?', [code]);
}

export async function markAuthCodeUsed(db, code) {
  await run(db, 'UPDATE auth_codes SET used = 1 WHERE code = ?', [code]);
}

export async function insertToken(db, token) {
  const sql = `INSERT INTO tokens (
    access_token,
    client_id,
    user_id,
    scope,
    expires_at
  ) VALUES (?, ?, ?, ?, ?)`;

  const params = [
    token.access_token,
    token.client_id,
    token.user_id,
    token.scope,
    token.expires_at
  ];

  await run(db, sql, params);
}

export async function getToken(db, accessToken) {
  return await get(db, 'SELECT * FROM tokens WHERE access_token = ?', [accessToken]);
}

export async function getUserById(db, userId) {
  return await get(db, 'SELECT * FROM users WHERE id = ?', [userId]);
}

export async function initializeDatabase() {
  const db = openDatabase();

  await new Promise((resolve, reject) => {
    db.serialize(async () => {
      try {
        db.run(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            email TEXT NOT NULL
          )
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id TEXT UNIQUE NOT NULL,
            client_secret TEXT NOT NULL,
            redirect_uris TEXT NOT NULL
          )
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS auth_codes (
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
          )
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            access_token TEXT UNIQUE NOT NULL,
            client_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            scope TEXT NOT NULL,
            expires_at INTEGER NOT NULL
          )
        `);

        const client = await get(db, 'SELECT id FROM clients WHERE client_id = ?', ['test-client']);
        if (!client) {
          await run(db,
            'INSERT INTO clients (client_id, client_secret, redirect_uris) VALUES (?, ?, ?)',
            ['test-client', 'test-secret', JSON.stringify(['http://localhost:8080/callback', 'http://localhost:4001/callback'])]
          );
        }

        const user = await get(db, 'SELECT id FROM users WHERE username = ?', ['testuser']);
        if (!user) {
          await run(db,
            'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
            ['testuser', 'password123', 'testuser@example.com']
          );
        }

        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });

  return db;
}
