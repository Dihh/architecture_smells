import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import dotenv from 'dotenv';

dotenv.config();

const DB_PATH = process.env.DB_PATH || './chat.db';

let dbInstance = null;

export async function initDB() {
  dbInstance = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  // Create users table
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);

  // Create messages table
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id   INTEGER NOT NULL,
      username  TEXT NOT NULL,
      content   TEXT NOT NULL,
      timestamp TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);

  return dbInstance;
}

export function getDB() {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDB first.');
  }
  return dbInstance;
}
