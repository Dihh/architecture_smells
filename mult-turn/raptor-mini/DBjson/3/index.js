'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID, createHash } = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const DB_PATH = process.env.DB_PATH;
const JWT_SECRET = process.env.JWT_SECRET || 'default_jwt_secret';

if (!DB_PATH) {
  console.error('DB_PATH env var is required.');
  process.exit(1);
}

const dbFilePath = path.resolve(DB_PATH);
const initialDbShape = { _users: [], _teams: [] };

function ensureDbDirectory(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeDb(data) {
  const serialized = JSON.stringify(data, null, 2);
  const tmpPath = `${dbFilePath}.tmp`;
  fs.writeFileSync(tmpPath, serialized, 'utf8');
  fs.renameSync(tmpPath, dbFilePath);
}

let writeLock = Promise.resolve();

async function withWriteLock(fn) {
  const previous = writeLock;
  let release;
  writeLock = new Promise((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function normalizeDb(data) {
  const normalized = { ...data };

  if (!Array.isArray(normalized._users)) {
    normalized._users = [];
  }

  if (!Array.isArray(normalized._teams)) {
    normalized._teams = [];
  }

  return normalized;
}

function loadDb() {
  try {
    const raw = fs.readFileSync(dbFilePath, 'utf8');
    if (!raw.trim()) {
      writeDb(initialDbShape);
      return { ...initialDbShape };
    }

    const parsed = JSON.parse(raw);
    const normalized = normalizeDb(parsed);

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      writeDb(normalized);
    }

    return normalized;
  } catch (error) {
    if (error.code === 'ENOENT') {
      ensureDbDirectory(dbFilePath);
      writeDb(initialDbShape);
      return { ...initialDbShape };
    }

    console.error('Failed to load DB file:', error.message);
    process.exit(1);
  }
}

function readDb() {
  return loadDb();
}

function saveDb(db) {
  writeDb(normalizeDb(db));
}

function getCollection(db, resource) {
  if (!Array.isArray(db[resource])) {
    db[resource] = [];
  }
  return db[resource];
}

function findItem(collection, id) {
  return collection.find((item) => item && String(item.id) === String(id));
}

function hashPassword(password) {
  return createHash('sha256').update(String(password), 'utf8').digest('hex');
}

function sanitizeItem(resource, item) {
  if (!item || typeof item !== 'object' || resource !== '_users') {
    return item;
  }

  const { passwordHash, ...safeFields } = item;
  return safeFields;
}

function sanitizeCollection(resource, collection) {
  if (!Array.isArray(collection)) {
    return collection;
  }

  return collection.map((item) => sanitizeItem(resource, item));
}

function findUserByUsername(db, username) {
  const users = getCollection(db, '_users');
  return users.find((user) => user && user.username === username);
}

function findTeamById(db, id) {
  const teams = getCollection(db, '_teams');
  return findItem(teams, id);
}

function isTeamMember(userId, team) {
  return Array.isArray(team.members) && team.members.some((member) => String(member) === String(userId));
}

function isTeamOwner(req, team) {
  return team && String(team.ownerId) === String(req.user.id);
}

function canManageTeam(req, team) {
  return isAdmin(req) || isTeamOwner(req, team);
}

function isAdmin(req) {
  return req.user && req.user.role === 'admin';
}

function getSharedAccess(item, userId, teamIds = []) {
  if (!item) {
    return null;
  }

  const userAccess = Array.isArray(item.sharedWith)
    ? item.sharedWith.find((share) => share && String(share.userId) === String(userId))
    : null;

  const teamAccess = Array.isArray(item.sharedWithTeams)
    ? item.sharedWithTeams
        .filter((share) => share && String(share.teamId) && teamIds.includes(String(share.teamId)))
        .map((share) => ({
          teamId: String(share.teamId),
          access: share.access === 'write' ? 'write' : share.access === 'read' ? 'read' : null
        }))
        .filter((share) => share.access !== null)
    : [];

  const userAccessValue = userAccess && (userAccess.access === 'write' || userAccess.access === 'read')
    ? userAccess.access
    : null;

  const teamAccessValue = teamAccess.some((share) => share.access === 'write')
    ? 'write'
    : teamAccess.some((share) => share.access === 'read')
      ? 'read'
      : null;

  if (userAccessValue === 'write' || teamAccessValue === 'write') {
    return 'write';
  }

  if (userAccessValue === 'read' || teamAccessValue === 'read') {
    return 'read';
  }

  return null;
}

function getTeamIdsForUser(req, db) {
  const teams = getCollection(db, '_teams');
  return teams
    .filter((team) => Array.isArray(team.members) && team.members.some((member) => String(member) === String(req.user.id)))
    .map((team) => String(team.id));
}

function hasSharedAccess(req, item, db) {
  return getSharedAccess(item, req.user.id, getTeamIdsForUser(req, db)) !== null;
}

function authorizedForRead(req, item, db) {
  return isAdmin(req) ||
    (item && String(item.ownerId) === String(req.user.id)) ||
    getSharedAccess(item, req.user.id, getTeamIdsForUser(req, db)) !== null;
}

function authorizedForWrite(req, item, db) {
  return isAdmin(req) ||
    (item && String(item.ownerId) === String(req.user.id)) ||
    getSharedAccess(item, req.user.id, getTeamIdsForUser(req, db)) === 'write';
}

function authorizedForDelete(req, item) {
  return isAdmin(req) ||
    (item && String(item.ownerId) === String(req.user.id));
}

function validateSharedWith(value) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const valid = value
    .filter((share) => share && share.userId && typeof share.access === 'string')
    .map((share) => ({
      userId: String(share.userId),
      access: share.access === 'write' ? 'write' : share.access === 'read' ? 'read' : null
    }))
    .filter((share) => share.access !== null);

  return valid;
}

function validateSharedWithTeams(value) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const valid = value
    .filter((share) => share && share.teamId && typeof share.access === 'string')
    .map((share) => ({
      teamId: String(share.teamId),
      access: share.access === 'write' ? 'write' : share.access === 'read' ? 'read' : null
    }))
    .filter((share) => share.access !== null);

  return valid;
}

function cleanPayloadForOwner(body) {
  const payload = { ...body };
  delete payload.id;
  delete payload.ownerId;
  delete payload.createdAt;
  delete payload.updatedAt;

  const sharedWith = validateSharedWith(payload.sharedWith);
  if (sharedWith !== undefined) {
    payload.sharedWith = sharedWith;
  } else {
    delete payload.sharedWith;
  }

  const sharedWithTeams = validateSharedWithTeams(payload.sharedWithTeams);
  if (sharedWithTeams !== undefined) {
    payload.sharedWithTeams = sharedWithTeams;
  } else {
    delete payload.sharedWithTeams;
  }

  return payload;
}

function cleanPayloadForGrantee(body) {
  const payload = { ...body };
  delete payload.id;
  delete payload.ownerId;
  delete payload.createdAt;
  delete payload.updatedAt;
  delete payload.sharedWith;
  delete payload.sharedWithTeams;
  return payload;
}

function createResourceItem(body, user) {
  const now = new Date().toISOString();
  return {
    ...body,
    id: randomUUID(),
    ownerId: user.id,
    createdAt: now
  };
}

function normalizeUpdatePayload(body, existing) {
  const now = new Date().toISOString();
  return {
    ...existing,
    ...body,
    id: existing.id,
    ownerId: existing.ownerId,
    createdAt: existing.createdAt,
    updatedAt: now
  };
}

const RESERVED_QUERY_KEYS = new Set(['_sort', '_order', '_limit', '_offset', '_or']);

function parseQueryValue(raw) {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}

function parseFilterOperator(paramKey) {
  const parts = paramKey.split('__');
  const field = parts[0];
  const operator = parts.length > 1 ? parts[1] : 'eq';
  return { field, operator };
}

function normalizeFilterValue(operator, rawValue) {
  if (operator === 'between' || operator === 'in') {
    return rawValue.split(',').map((value) => parseQueryValue(value));
  }
  return parseQueryValue(rawValue);
}

function matchFilter(item, field, operator, rawValue) {
  const value = item ? item[field] : undefined;
  const filterValue = normalizeFilterValue(operator, rawValue);

  if (operator === 'eq') {
    return value === filterValue;
  }

  if (operator === 'ne') {
    return value !== filterValue;
  }

  if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte' || operator === 'between') {
    const itemNumber = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(itemNumber)) {
      return false;
    }

    if (operator === 'between') {
      const [lo, hi] = filterValue;
      return itemNumber >= lo && itemNumber <= hi;
    }

    if (operator === 'gt') {
      return itemNumber > filterValue;
    }
    if (operator === 'gte') {
      return itemNumber >= filterValue;
    }
    if (operator === 'lt') {
      return itemNumber < filterValue;
    }
    if (operator === 'lte') {
      return itemNumber <= filterValue;
    }
  }

  if (operator === 'contains' || operator === 'startswith' || operator === 'endswith') {
    if (value == null) {
      return false;
    }
    const text = String(value).toLowerCase();
    const search = String(filterValue).toLowerCase();

    if (operator === 'contains') {
      return text.includes(search);
    }
    if (operator === 'startswith') {
      return text.startsWith(search);
    }
    if (operator === 'endswith') {
      return text.endsWith(search);
    }
  }

  if (operator === 'in') {
    return filterValue.some((candidate) => candidate === value);
  }

  return false;
}

function applyQueryFilters(items, query) {
  const conditions = [];
  const orMode = String(query._or).toLowerCase() === 'true';

  Object.entries(query).forEach(([key, rawValue]) => {
    if (RESERVED_QUERY_KEYS.has(key)) {
      return;
    }

    const { field, operator } = parseFilterOperator(key);
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    conditions.push({ field, operator, value });
  });

  const filtered = items.filter((item) => {
    if (conditions.length === 0) {
      return true;
    }

    const results = conditions.map((condition) =>
      matchFilter(item, condition.field, condition.operator, condition.value)
    );

    return orMode ? results.some(Boolean) : results.every(Boolean);
  });

  const sortField = query._sort;
  const sortOrder = String(query._order || 'asc').toLowerCase();
  if (sortField) {
    filtered.sort((a, b) => {
      const aValue = a ? a[sortField] : undefined;
      const bValue = b ? b[sortField] : undefined;

      if (aValue === bValue) {
        return 0;
      }
      if (aValue === undefined || aValue === null) {
        return 1;
      }
      if (bValue === undefined || bValue === null) {
        return -1;
      }

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
      }

      const aText = String(aValue).toLowerCase();
      const bText = String(bValue).toLowerCase();
      return sortOrder === 'desc' ? bText.localeCompare(aText) : aText.localeCompare(bText);
    });
  }

  const offset = Number.isNaN(Number(query._offset)) ? 0 : Number(query._offset);
  const limit = Number.isNaN(Number(query._limit)) ? null : Number(query._limit);
  const total = filtered.length;

  if (limit !== null || offset !== 0) {
    const paged = filtered.slice(offset, limit === null ? undefined : offset + limit);
    return { data: paged, total, limit, offset };
  }

  return filtered;
}

function resourceCollectionForUser(req, collection, db) {
  if (isAdmin(req)) {
    return collection;
  }

  return collection.filter((item) => {
    if (!item) {
      return false;
    }

    return String(item.ownerId) === String(req.user.id) || hasSharedAccess(req, item, db);
  });
}

function isReservedResource(resource) {
  return resource === '_users' || resource === '_teams';
}

function guardReservedResource(req, res, next) {
  const resource = req.params.resource;
  if (isReservedResource(resource)) {
    return res.status(400).json({ error: 'Reserved resource' });
  }
  return next();
}

function authorizeAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

function authenticate(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Bearer token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const app = express();
app.use(express.json());

app.post('/auth/register', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const db = readDb();
  const users = getCollection(db, '_users');

  if (findUserByUsername(db, username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const role = users.length === 0 ? 'admin' : 'user';
  const user = {
    id: randomUUID(),
    username,
    role,
    passwordHash: hashPassword(password)
  };

  users.push(user);
  saveDb(db);

  res.status(201).json(sanitizeItem('_users', user));
});

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const db = readDb();
  const user = findUserByUsername(db, username);

  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  res.status(200).json({ token });
});

app.get('/auth/me', authenticate, (req, res) => {
  res.status(200).json(req.user);
});

app.get('/auth/users', authenticate, authorizeAdmin, (req, res) => {
  const db = readDb();
  const users = getCollection(db, '_users');
  res.status(200).json(sanitizeCollection('_users', users));
});

app.patch('/auth/users/:id/role', authenticate, authorizeAdmin, (req, res) => {
  const role = req.body.role;
  if (role !== 'admin' && role !== 'user') {
    return res.status(400).json({ error: 'Role must be admin or user' });
  }

  const db = readDb();
  const users = getCollection(db, '_users');
  const user = users.find((item) => item && String(item.id) === String(req.params.id));

  if (!user) {
    return res.status(404).json({ error: 'Not found' });
  }

  user.role = role;
  saveDb(db);

  res.status(200).json(sanitizeItem('_users', user));
});

app.post('/auth/teams', authenticate, (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const db = readDb();
  const teams = getCollection(db, '_teams');
  const team = {
    id: randomUUID(),
    name,
    ownerId: req.user.id,
    members: [req.user.id]
  };

  teams.push(team);
  saveDb(db);

  res.status(201).json(team);
});

app.post('/auth/teams/:id/members', authenticate, (req, res) => {
  const userId = req.body.userId;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const db = readDb();
  const team = findTeamById(db, req.params.id);
  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }

  if (!canManageTeam(req, team)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const users = getCollection(db, '_users');
  const user = users.find((item) => item && String(item.id) === String(userId));
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (!Array.isArray(team.members)) {
    team.members = [];
  }

  if (!team.members.some((member) => String(member) === String(userId))) {
    team.members.push(userId);
    saveDb(db);
  }

  res.status(200).json(team);
});

app.delete('/auth/teams/:id/members/:userId', authenticate, (req, res) => {
  const db = readDb();
  const team = findTeamById(db, req.params.id);

  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }

  if (!isTeamOwner(req, team)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const userId = req.params.userId;
  if (String(userId) === String(team.ownerId)) {
    return res.status(400).json({ error: 'Owner cannot be removed' });
  }

  team.members = (team.members || []).filter((member) => String(member) !== String(userId));
  saveDb(db);

  res.status(200).json(team);
});

app.get('/auth/teams', authenticate, (req, res) => {
  const db = readDb();
  const teams = getCollection(db, '_teams');
  const memberTeams = teams.filter((team) => isTeamMember(req.user.id, team));
  res.status(200).json({ teams: memberTeams });
});

app.get('/auth/teams/:id', authenticate, (req, res) => {
  const db = readDb();
  const team = findTeamById(db, req.params.id);
  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }

  if (!isTeamMember(req.user.id, team) && !isAdmin(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.status(200).json(team);
});

app.patch('/auth/teams/:id', authenticate, (req, res) => {
  const db = readDb();
  const team = findTeamById(db, req.params.id);
  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }

  if (!isTeamOwner(req, team)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { name } = req.body;
  if (name !== undefined) {
    team.name = name;
  }

  saveDb(db);
  res.status(200).json(team);
});

app.delete('/auth/teams/:id', authenticate, (req, res) => {
  const db = readDb();
  const teams = getCollection(db, '_teams');
  const index = teams.findIndex((team) => team && String(team.id) === String(req.params.id));

  if (index === -1) {
    return res.status(404).json({ error: 'Team not found' });
  }

  const team = teams[index];
  if (!isTeamOwner(req, team)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  teams.splice(index, 1);
  saveDb(db);
  res.status(204).send();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/:resource', authenticate, guardReservedResource, (req, res) => {
  const resource = req.params.resource;
  const db = readDb();
  const collection = getCollection(db, resource);
  const filtered = resourceCollectionForUser(req, collection, db);
  const queried = applyQueryFilters(filtered, req.query);

  if (queried && typeof queried === 'object' && !Array.isArray(queried)) {
    res.status(200).json({
      data: sanitizeCollection(resource, queried.data),
      total: queried.total,
      limit: queried.limit,
      offset: queried.offset
    });
    return;
  }

  res.status(200).json(sanitizeCollection(resource, queried));
});

app.get('/:resource/:id', authenticate, guardReservedResource, (req, res) => {
  const resource = req.params.resource;
  const id = req.params.id;
  const db = readDb();
  const collection = getCollection(db, resource);
  const item = findItem(collection, id);

  if (!item) {
    return res.status(404).json({ error: 'Not found' });
  }

  if (!authorizedForRead(req, item, db)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.status(200).json(sanitizeItem(resource, item));
});

app.post('/:resource', authenticate, guardReservedResource, async (req, res) => {
  await withWriteLock(async () => {
    const resource = req.params.resource;
    const db = readDb();
    const collection = getCollection(db, resource);
    const payload = cleanPayloadForOwner(req.body);

    const item = createResourceItem(payload, req.user);
    collection.push(item);
    saveDb(db);

    res.status(201).json(sanitizeItem(resource, item));
  });
});

app.put('/:resource/:id', authenticate, guardReservedResource, async (req, res) => {
  await withWriteLock(async () => {
    const resource = req.params.resource;
    const id = req.params.id;
    const db = readDb();
    const collection = getCollection(db, resource);
    const index = collection.findIndex((item) => item && String(item.id) === String(id));

    if (index === -1) {
      return res.status(404).json({ error: 'Not found' });
    }

    const existing = collection[index];
    if (!authorizedForWrite(req, existing, db)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const payload = req.user && String(existing.ownerId) === String(req.user.id)
      ? cleanPayloadForOwner(req.body)
      : cleanPayloadForGrantee(req.body);

    const replaced = normalizeUpdatePayload(payload, existing);
    collection[index] = replaced;
    saveDb(db);

    res.status(200).json(sanitizeItem(resource, replaced));
  });
});

app.patch('/:resource/:id', authenticate, guardReservedResource, async (req, res) => {
  await withWriteLock(async () => {
    const resource = req.params.resource;
    const id = req.params.id;
    const db = readDb();
    const collection = getCollection(db, resource);
    const index = collection.findIndex((item) => item && String(item.id) === String(id));

    if (index === -1) {
      return res.status(404).json({ error: 'Not found' });
    }

    const existing = collection[index];
    if (!authorizedForWrite(req, existing, db)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const payload = req.user && String(existing.ownerId) === String(req.user.id)
      ? cleanPayloadForOwner(req.body)
      : cleanPayloadForGrantee(req.body);

    const updated = normalizeUpdatePayload(payload, existing);
    collection[index] = updated;
    saveDb(db);

    res.status(200).json(sanitizeItem(resource, updated));
  });
});

app.delete('/:resource/:id', authenticate, guardReservedResource, async (req, res) => {
  await withWriteLock(async () => {
    const resource = req.params.resource;
    const id = req.params.id;
    const db = readDb();
    const collection = getCollection(db, resource);
    const index = collection.findIndex((item) => item && String(item.id) === String(id));

    if (index === -1) {
      return res.status(404).json({ error: 'Not found' });
    }

    const existing = collection[index];
    if (!authorizedForDelete(req, existing)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    collection.splice(index, 1);
    saveDb(db);

    res.status(204).send();
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} (running on)`);
  console.log(`Loaded DB file from: ${dbFilePath}`);
});
