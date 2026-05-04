const express = require('express');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH;
const JWT_SECRET = process.env.JWT_SECRET || randomUUID();

const DEFAULT_DB = { _users: [], _teams: [] };

let db = DEFAULT_DB;

function loadDb() {
  if (!DB_PATH) return DEFAULT_DB;

  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8').trim();
    if (!raw) {
      fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
      return DEFAULT_DB;
    }
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      const dir = path.dirname(DB_PATH);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
      return DEFAULT_DB;
    }
    throw err;
  }
}

function persistDb() {
  if (!DB_PATH) return;
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

// Serializes all write operations through a promise chain so concurrent
// requests cannot interleave mutations or produce torn file writes.
let writeQueue = Promise.resolve();
function writeDb(fn) {
  return new Promise((resolve, reject) => {
    writeQueue = writeQueue.then(() => {
      try { resolve(fn()); persistDb(); }
      catch (err) { reject(err); }
    });
  });
}

function getCollection(resource) {
  const key = `_${resource}`;
  if (!Array.isArray(db[key])) {
    db[key] = [];
  }
  return db[key];
}

db = loadDb();

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// --- middleware ---

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

const RESERVED = new Set(['users', 'teams']);

function blockReserved(req, res, next) {
  if (RESERVED.has(req.params.resource)) {
    return res.status(403).json({ error: `Collection "${req.params.resource}" is reserved` });
  }
  next();
}

// --- auth routes (registered before dynamic routes to avoid collision) ---

app.post('/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const users = getCollection('users');
  if (users.find(u => u.username === username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const role = users.length === 0 ? 'admin' : 'user';
  const user = { id: randomUUID(), username, passwordHash, role };
  users.push(user);
  persistDb();

  res.status(201).json({ id: user.id, username: user.username, role: user.role });
});

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const users = getCollection('users');
  const user = users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.json({ token });
});

app.get('/auth/me', requireAuth, (req, res) => {
  const { sub: id, username, role } = req.user;
  res.json({ id, username, role });
});

app.get('/auth/users', requireAuth, requireAdmin, (req, res) => {
  const users = getCollection('users').map(({ passwordHash: _, ...u }) => u);
  res.json(users);
});

app.patch('/auth/users/:id/role', requireAuth, requireAdmin, (req, res) => {
  const { role } = req.body || {};
  if (role !== 'admin' && role !== 'user') {
    return res.status(400).json({ error: 'role must be "admin" or "user"' });
  }
  const users = getCollection('users');
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users[idx].role = role;
  persistDb();
  const { passwordHash: _, ...updated } = users[idx];
  res.json(updated);
});

// --- team routes ---

app.post('/auth/teams', requireAuth, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const team = await writeDb(() => {
    const t = { id: randomUUID(), name, ownerId: req.user.sub, members: [req.user.sub] };
    getCollection('teams').push(t);
    return t;
  });
  res.status(201).json(team);
});

app.get('/auth/teams', requireAuth, (req, res) => {
  const teams = getCollection('teams').filter(t => t.members.includes(req.user.sub));
  res.json(teams);
});

app.get('/auth/teams/:id', requireAuth, (req, res) => {
  const team = getCollection('teams').find(t => t.id === req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!team.members.includes(req.user.sub) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(team);
});

app.patch('/auth/teams/:id', requireAuth, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const teams = getCollection('teams');
  const idx = teams.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Team not found' });
  if (teams[idx].ownerId !== req.user.sub && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const updated = await writeDb(() => { teams[idx] = { ...teams[idx], name }; return teams[idx]; });
  res.json(updated);
});

app.delete('/auth/teams/:id', requireAuth, async (req, res) => {
  const teams = getCollection('teams');
  const idx = teams.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Team not found' });
  if (teams[idx].ownerId !== req.user.sub && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await writeDb(() => teams.splice(idx, 1));
  res.status(204).send();
});

app.post('/auth/teams/:id/members', requireAuth, async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  const teams = getCollection('teams');
  const team = teams.find(t => t.id === req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (team.ownerId !== req.user.sub && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!getCollection('users').find(u => u.id === userId)) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (!team.members.includes(userId)) {
    await writeDb(() => team.members.push(userId));
  }
  res.json(team);
});

app.delete('/auth/teams/:id/members/:userId', requireAuth, async (req, res) => {
  const teams = getCollection('teams');
  const team = teams.find(t => t.id === req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (team.ownerId !== req.user.sub && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await writeDb(() => { team.members = team.members.filter(m => m !== req.params.userId); });
  res.json(team);
});

// --- dynamic CRUD routes ---

function stripSystemFields(body) {
  const { id, ownerId, createdAt, updatedAt, ...rest } = body || {};
  return rest;
}

// --- query engine ---

const RESERVED_PARAMS = new Set(['_sort', '_order', '_limit', '_offset', '_or']);

function coerce(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const n = Number(value);
  return !isNaN(n) && value !== '' ? n : value;
}

function parseFilters(query) {
  return Object.entries(query)
    .filter(([k]) => !RESERVED_PARAMS.has(k))
    .map(([key, rawValue]) => {
      const dIdx = key.lastIndexOf('__');
      return dIdx === -1
        ? { field: key, op: 'eq', rawValue }
        : { field: key.slice(0, dIdx), op: key.slice(dIdx + 2), rawValue };
    });
}

function matchesFilter(item, { field, op, rawValue }) {
  const v = item[field];
  switch (op) {
    case 'eq':         return v === coerce(rawValue);
    case 'ne':         return v !== coerce(rawValue);
    case 'gt':         return v > coerce(rawValue);
    case 'gte':        return v >= coerce(rawValue);
    case 'lt':         return v < coerce(rawValue);
    case 'lte':        return v <= coerce(rawValue);
    case 'between': {
      const [lo, hi] = rawValue.split(',').map(Number);
      return v >= lo && v <= hi;
    }
    case 'contains':   return String(v).toLowerCase().includes(rawValue.toLowerCase());
    case 'startswith': return String(v).toLowerCase().startsWith(rawValue.toLowerCase());
    case 'endswith':   return String(v).toLowerCase().endsWith(rawValue.toLowerCase());
    case 'in':         return rawValue.split(',').map(coerce).includes(v);
    default:           return true;
  }
}

function applyQuery(items, query) {
  const filters = parseFilters(query);
  const useOr  = query._or === 'true';
  const sortBy = query._sort;
  const order  = query._order === 'desc' ? -1 : 1;
  const limit  = query._limit  !== undefined ? parseInt(query._limit,  10) : null;
  const offset = query._offset !== undefined ? parseInt(query._offset, 10) : 0;

  let result = filters.length === 0 ? items : items.filter(item =>
    useOr ? filters.some(f => matchesFilter(item, f))
          : filters.every(f => matchesFilter(item, f))
  );

  if (sortBy) {
    result = [...result].sort((a, b) => {
      if (a[sortBy] < b[sortBy]) return -order;
      if (a[sortBy] > b[sortBy]) return  order;
      return 0;
    });
  }

  const total = result.length;

  if (limit !== null || offset > 0) {
    result = result.slice(offset, limit !== null ? offset + limit : undefined);
    return { data: result, total, limit: limit ?? result.length, offset };
  }

  return result;
}

// Returns the caller's effective access level for an item:
// 'owner' | 'write' | 'read' | null
function callerAccess(item, user) {
  if (user.role === 'admin' || item.ownerId === user.sub) return 'owner';

  const userEntry = Array.isArray(item.sharedWith)
    ? item.sharedWith.find(s => s.userId === user.sub)
    : null;

  const callerTeamIds = new Set(
    getCollection('teams').filter(t => t.members.includes(user.sub)).map(t => t.id)
  );
  const teamEntries = Array.isArray(item.sharedWithTeams)
    ? item.sharedWithTeams.filter(s => callerTeamIds.has(s.teamId))
    : [];

  const accesses = [
    ...(userEntry ? [userEntry.access] : []),
    ...teamEntries.map(s => s.access),
  ];
  if (!accesses.length) return null;
  // 'write' beats 'read'
  return accesses.includes('write') ? 'write' : 'read';
}

function isVisibleTo(item, user) {
  return callerAccess(item, user) !== null;
}

app.get('/:resource', requireAuth, blockReserved, (req, res) => {
  const collection = getCollection(req.params.resource);
  const isAdmin = req.user.role === 'admin';
  const visible = isAdmin ? collection : collection.filter(i => isVisibleTo(i, req.user));
  res.json(applyQuery(visible, req.query));
});

app.get('/:resource/:id', requireAuth, blockReserved, (req, res) => {
  const collection = getCollection(req.params.resource);
  const item = collection.find(i => String(i.id) === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!isVisibleTo(item, req.user)) return res.status(403).json({ error: 'Forbidden' });
  res.json(item);
});

app.post('/:resource', requireAuth, blockReserved, async (req, res) => {
  try {
    const now = new Date().toISOString();
    const { sharedWith, sharedWithTeams, ...rest } = stripSystemFields(req.body);
    const item = await writeDb(() => {
      const collection = getCollection(req.params.resource);
      const created = {
        ...rest,
        id: randomUUID(),
        ownerId: req.user.sub,
        createdAt: now,
        ...(Array.isArray(sharedWith) && { sharedWith }),
        ...(Array.isArray(sharedWithTeams) && { sharedWithTeams }),
      };
      collection.push(created);
      return created;
    });
    res.status(201).json(item);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/:resource/:id', requireAuth, blockReserved, async (req, res) => {
  try {
    const collection = getCollection(req.params.resource);
    const existing = collection.find(i => String(i.id) === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const access = callerAccess(existing, req.user);
    if (!access || access === 'read') return res.status(403).json({ error: 'Forbidden' });

    const { sharedWith, sharedWithTeams, ...rest } = stripSystemFields(req.body);
    const isOwner = access === 'owner';
    const updated = await writeDb(() => {
      const idx = collection.findIndex(i => String(i.id) === req.params.id);
      if (idx === -1) throw Object.assign(new Error('Not found'), { status: 404 });
      collection[idx] = {
        ...rest,
        id: existing.id,
        ownerId: existing.ownerId,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
        ...(isOwner
          ? { ...(Array.isArray(sharedWith) ? { sharedWith } : {}), ...(Array.isArray(sharedWithTeams) ? { sharedWithTeams } : {}) }
          : { ...(existing.sharedWith !== undefined ? { sharedWith: existing.sharedWith } : {}), ...(existing.sharedWithTeams !== undefined ? { sharedWithTeams: existing.sharedWithTeams } : {}) }),
      };
      return collection[idx];
    });
    res.json(updated);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/:resource/:id', requireAuth, blockReserved, async (req, res) => {
  try {
    const collection = getCollection(req.params.resource);
    const existing = collection.find(i => String(i.id) === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const access = callerAccess(existing, req.user);
    if (!access || access === 'read') return res.status(403).json({ error: 'Forbidden' });

    const { sharedWith, sharedWithTeams, ...rest } = stripSystemFields(req.body);
    const isOwner = access === 'owner';
    const updated = await writeDb(() => {
      const idx = collection.findIndex(i => String(i.id) === req.params.id);
      if (idx === -1) throw Object.assign(new Error('Not found'), { status: 404 });
      collection[idx] = {
        ...collection[idx],
        ...rest,
        id: existing.id,
        ownerId: existing.ownerId,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
        ...(isOwner && Array.isArray(sharedWith) ? { sharedWith } : {}),
        ...(isOwner && Array.isArray(sharedWithTeams) ? { sharedWithTeams } : {}),
      };
      return collection[idx];
    });
    res.json(updated);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/:resource/:id', requireAuth, blockReserved, async (req, res) => {
  try {
    const collection = getCollection(req.params.resource);
    const item = collection.find(i => String(i.id) === req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (callerAccess(item, req.user) !== 'owner') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await writeDb(() => {
      const idx = collection.findIndex(i => String(i.id) === req.params.id);
      if (idx === -1) throw Object.assign(new Error('Not found'), { status: 404 });
      collection.splice(idx, 1);
    });
    res.status(204).send();
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
