import sqlite3 from 'sqlite3';

const sqlite = sqlite3.verbose();

export function openDatabase(filename = 'oidc-provider.db') {
  return new sqlite.Database(filename);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function runStatement(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
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

export async function findClientByClientId(db, clientId) {
  return get(
    db,
    `SELECT id, client_id, client_secret, redirect_uris
     FROM clients
     WHERE client_id = ?`,
    [clientId]
  );
}

export async function findUserByUsername(db, username) {
  return get(
    db,
    `SELECT id, username, password, email
     FROM users
     WHERE username = ?`,
    [username]
  );
}

export async function findUserById(db, userId) {
  return get(
    db,
    `SELECT id, username, password, email
     FROM users
     WHERE id = ?`,
    [userId]
  );
}

export async function createAuthorizationCode(
  db,
  {
    code,
    clientId,
    userId,
    redirectUri,
    scope,
    codeChallenge,
    codeChallengeMethod,
    expiresAt,
  }
) {
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
      code,
      clientId,
      userId,
      redirectUri,
      scope,
      codeChallenge,
      codeChallengeMethod,
      expiresAt,
    ]
  );
}

export async function findAuthorizationCode(db, code) {
  return get(
    db,
    `SELECT
      id,
      code,
      client_id,
      user_id,
      redirect_uri,
      scope,
      code_challenge,
      code_challenge_method,
      expires_at,
      used
     FROM auth_codes
     WHERE code = ?`,
    [code]
  );
}

export async function markAuthorizationCodeUsed(db, code) {
  return run(
    db,
    `UPDATE auth_codes
     SET used = 1
     WHERE code = ? AND used = 0`,
    [code]
  );
}

export async function createToken(
  db,
  { accessToken, clientId, userId, scope, expiresAt }
) {
  return run(
    db,
    `INSERT INTO tokens (
      access_token,
      client_id,
      user_id,
      scope,
      expires_at
    ) VALUES (?, ?, ?, ?, ?)`,
    [accessToken, clientId, userId, scope, expiresAt]
  );
}

export async function findTokenByAccessToken(db, accessToken) {
  return get(
    db,
    `SELECT id, access_token, client_id, user_id, scope, expires_at
     FROM tokens
     WHERE access_token = ?`,
    [accessToken]
  );
}

export async function initializeDatabase(db) {
  await run(db, 'PRAGMA foreign_keys = ON');

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT NOT NULL
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT UNIQUE NOT NULL,
      client_secret TEXT NOT NULL,
      redirect_uris TEXT NOT NULL
    )`
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
    )`
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
    )`
  );

  await seedDatabase(db);
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
    ]
  );

  await run(
    db,
    `INSERT OR IGNORE INTO users (username, password, email)
     VALUES (?, ?, ?)`,
    ['testuser', 'password123', 'testuser@example.com']
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
