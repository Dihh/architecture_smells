import sqlite3 from "sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const databasePath = join(__dirname, "../data/database.sqlite");

function openSqliteDatabase() {
  return new sqlite3.Database(databasePath);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function exec(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export async function openDatabase() {
  const db = openSqliteDatabase();

  await exec(db, `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT UNIQUE NOT NULL,
      client_secret TEXT NOT NULL,
      redirect_uris TEXT NOT NULL
    );

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
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      access_token TEXT UNIQUE NOT NULL,
      client_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      scope TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  await seedDatabase(db);
  return db;
}

async function seedDatabase(db) {
  const existingClient = await get(
    db,
    "SELECT id FROM clients WHERE client_id = ?",
    ["test-client"]
  );

  if (!existingClient) {
    await run(
      db,
      "INSERT INTO clients (client_id, client_secret, redirect_uris) VALUES (?, ?, ?)",
      [
        "test-client",
        "test-secret",
        JSON.stringify(["http://localhost:8080/callback", "http://localhost:4001/callback"]),
      ]
    );
  }

  const existingUser = await get(db, "SELECT id FROM users WHERE username = ?", ["testuser"]);

  if (!existingUser) {
    await run(
      db,
      "INSERT INTO users (username, password, email) VALUES (?, ?, ?)",
      ["testuser", "password123", "testuser@example.com"]
    );
  }
}

export function getClientById(db, clientId) {
  return get(db, "SELECT * FROM clients WHERE client_id = ?", [clientId]);
}

export function getUserByUsername(db, username) {
  return get(db, "SELECT * FROM users WHERE username = ?", [username]);
}

export function getUserById(db, userId) {
  return get(db, "SELECT * FROM users WHERE id = ?", [userId]);
}

export function getAuthCode(db, code) {
  return get(db, "SELECT * FROM auth_codes WHERE code = ?", [code]);
}

export function markAuthCodeUsed(db, code) {
  return run(db, "UPDATE auth_codes SET used = 1 WHERE code = ?", [code]);
}

export function getToken(db, accessToken) {
  return get(db, "SELECT * FROM tokens WHERE access_token = ?", [accessToken]);
}

export function insertAuthCode(db, authCode) {
  return run(
    db,
    `INSERT INTO auth_codes (
      code,
      client_id,
      user_id,
      redirect_uri,
      scope,
      code_challenge,
      code_challenge_method,
      expires_at,
      used
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      authCode.code,
      authCode.client_id,
      authCode.user_id,
      authCode.redirect_uri,
      authCode.scope,
      authCode.code_challenge,
      authCode.code_challenge_method,
      authCode.expires_at,
    ]
  );
}

export function insertToken(db, token) {
  return run(
    db,
    `INSERT INTO tokens (
      access_token,
      client_id,
      user_id,
      scope,
      expires_at
    ) VALUES (?, ?, ?, ?, ?)`,
    [token.access_token, token.client_id, token.user_id, token.scope, token.expires_at]
  );
}
