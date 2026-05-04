const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_DB = { _users: [] };

function loadDb(dbPath) {
  if (!dbPath) throw new Error('DB_PATH env var is required');

  let data;
  try {
    const raw = fs.readFileSync(dbPath, 'utf8').trim();
    data = raw ? JSON.parse(raw) : null;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    data = null;
  }

  if (!data) {
    fs.writeFileSync(dbPath, JSON.stringify(DEFAULT_DB, null, 2));
    data = JSON.parse(JSON.stringify(DEFAULT_DB));
  }

  return data;
}

function saveDb(dbPath, data) {
  const tmp = `${dbPath}.tmp.${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, dbPath);
}

module.exports = { loadDb, saveDb };
