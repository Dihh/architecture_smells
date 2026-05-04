const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const dbPath = process.env.DB_PATH;
const jwtSecret = process.env.JWT_SECRET || 'dev-secret';

if (!dbPath) {
  console.error('Environment variable DB_PATH is required');
  process.exit(1);
}

const resolvedDbPath = path.resolve(dbPath);
const dbDirectory = path.dirname(resolvedDbPath);
const initialShape = { _users: [], _teams: [] };
let writeQueue = Promise.resolve();

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureCollection(db, resource) {
  if (!Object.prototype.hasOwnProperty.call(db, resource) || !Array.isArray(db[resource])) {
    db[resource] = [];
  }
  return db[resource];
}

function hashPassword(password, salt) {
  const usedSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, usedSalt, 64).toString('hex');
  return { salt: usedSalt, hash };
}

function verifyPassword(password, salt, hash) {
  const candidate = hashPassword(password, salt).hash;
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
}

function safeUserResponse(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
  };
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or malformed' });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'Authorization token missing' });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}

function reservedCollection(req, res, next) {
  const resource = req.params.resource;
  if (resource === '_users' || resource === '_teams') {
    return res.status(403).json({ error: 'Access to reserved collection is forbidden' });
  }
  next();
}

function currentTimestamp() {
  return new Date().toISOString();
}

function isAdmin(req) {
  return req.user && req.user.role === 'admin';
}

function normalizeSharedWith(sharedWith) {
  if (!Array.isArray(sharedWith)) {
    return undefined;
  }
  const normalized = sharedWith
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      userId: String(entry.userId),
      access: String(entry.access),
    }))
    .filter((entry) => entry.userId && (entry.access === 'read' || entry.access === 'write'));
  return normalized.length ? normalized : undefined;
}

function normalizeSharedWithTeams(sharedWithTeams) {
  if (!Array.isArray(sharedWithTeams)) {
    return undefined;
  }
  const normalized = sharedWithTeams
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      teamId: String(entry.teamId),
      access: String(entry.access),
    }))
    .filter((entry) => entry.teamId && (entry.access === 'read' || entry.access === 'write'));
  return normalized.length ? normalized : undefined;
}

function getShareAccess(item, userId) {
  if (!Array.isArray(item.sharedWith)) {
    return null;
  }
  const share = item.sharedWith.find((entry) => String(entry.userId) === String(userId));
  return share ? share.access : null;
}

function getTeamAccess(item, teamIds) {
  if (!Array.isArray(item.sharedWithTeams) || !teamIds.length) {
    return null;
  }
  let best = null;
  for (const entry of item.sharedWithTeams) {
    if (!entry || typeof entry !== 'object') continue;
    if (!teamIds.includes(String(entry.teamId))) continue;
    if (entry.access === 'write') {
      return 'write';
    }
    if (entry.access === 'read' && best !== 'write') {
      best = 'read';
    }
  }
  return best;
}

function getUserTeamIds(db, userId) {
  const teams = Array.isArray(db._teams) ? db._teams : [];
  return teams
    .filter((team) => Array.isArray(team.members) && team.members.some((member) => String(member) === String(userId)))
    .map((team) => team.id);
}

function canReadItem(req, item, db) {
  if (isAdmin(req)) {
    return true;
  }
  if (item.ownerId === req.user.id) {
    return true;
  }
  const access = getShareAccess(item, req.user.id);
  if (access === 'read' || access === 'write') {
    return true;
  }
  const teamAccess = getTeamAccess(item, getUserTeamIds(db, req.user.id));
  return teamAccess === 'read' || teamAccess === 'write';
}

function canWriteItem(req, item, db) {
  if (isAdmin(req)) {
    return true;
  }
  if (item.ownerId === req.user.id) {
    return true;
  }
  const access = getShareAccess(item, req.user.id);
  if (access === 'write') {
    return true;
  }
  const teamAccess = getTeamAccess(item, getUserTeamIds(db, req.user.id));
  return teamAccess === 'write';
}

function canDeleteItem(req, item) {
  if (isAdmin(req)) {
    return true;
  }
  return item.ownerId === req.user.id;
}

function filterVisibleItems(req, items, db) {
  if (isAdmin(req)) {
    return items;
  }
  return items.filter((item) => canReadItem(req, item, db));
}

const RESERVED_QUERY_PARAMS = new Set(['_sort', '_order', '_limit', '_offset', '_or']);

function parseQueryValue(rawValue) {
  if (rawValue === 'true') {
    return true;
  }
  if (rawValue === 'false') {
    return false;
  }
  if (rawValue === 'null') {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(rawValue)) {
    return Number(rawValue);
  }
  return rawValue;
}

function safeFieldValue(value) {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  return String(value);
}

function compareFieldValues(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function normalizeConditionValue(rawValue, actualValue) {
  if (typeof actualValue === 'boolean') {
    return rawValue === 'true';
  }
  if (typeof actualValue === 'number') {
    const numeric = Number(rawValue);
    return Number.isFinite(numeric) ? numeric : rawValue;
  }
  if (rawValue === 'true' || rawValue === 'false' || rawValue === 'null') {
    return parseQueryValue(rawValue);
  }
  const numeric = Number(rawValue);
  return Number.isNaN(numeric) ? rawValue : numeric;
}

function matchCondition(item, field, operator, rawValue) {
  const actual = item[field];
  if (operator === 'between') {
    if (typeof rawValue !== 'string') {
      return false;
    }
    const [low, high] = rawValue.split(',');
    if (low === undefined || high === undefined) {
      return false;
    }
    const actualNumber = Number(actual);
    const lowNumber = Number(low);
    const highNumber = Number(high);
    if (Number.isFinite(actualNumber) && Number.isFinite(lowNumber) && Number.isFinite(highNumber)) {
      return actualNumber >= lowNumber && actualNumber <= highNumber;
    }
    return String(actual) >= low && String(actual) <= high;
  }

  const expected = operator === 'in'
    ? String(rawValue).split(',').map((raw) => parseQueryValue(raw))
    : parseQueryValue(rawValue);
  const actualValue = actual;

  switch (operator) {
    case 'eq':
      return safeFieldValue(actualValue) === normalizeConditionValue(rawValue, actualValue);
    case 'ne':
      return safeFieldValue(actualValue) !== normalizeConditionValue(rawValue, actualValue);
    case 'gt': {
      const a = Number(actualValue);
      const b = Number(rawValue);
      return Number.isFinite(a) && Number.isFinite(b) && a > b;
    }
    case 'gte': {
      const a = Number(actualValue);
      const b = Number(rawValue);
      return Number.isFinite(a) && Number.isFinite(b) && a >= b;
    }
    case 'lt': {
      const a = Number(actualValue);
      const b = Number(rawValue);
      return Number.isFinite(a) && Number.isFinite(b) && a < b;
    }
    case 'lte': {
      const a = Number(actualValue);
      const b = Number(rawValue);
      return Number.isFinite(a) && Number.isFinite(b) && a <= b;
    }
    case 'contains': {
      if (actualValue === undefined || actualValue === null) return false;
      return String(actualValue).toLowerCase().includes(String(rawValue).toLowerCase());
    }
    case 'startswith': {
      if (actualValue === undefined || actualValue === null) return false;
      return String(actualValue).toLowerCase().startsWith(String(rawValue).toLowerCase());
    }
    case 'endswith': {
      if (actualValue === undefined || actualValue === null) return false;
      return String(actualValue).toLowerCase().endsWith(String(rawValue).toLowerCase());
    }
    case 'in': {
      if (!Array.isArray(expected)) {
        return false;
      }
      return expected.some((candidate) => safeFieldValue(actualValue) === normalizeConditionValue(String(candidate), actualValue));
    }
    default:
      return false;
  }
}

function buildQueryPredicates(query) {
  const predicates = [];
  for (const [rawKey, rawValue] of Object.entries(query)) {
    if (RESERVED_QUERY_PARAMS.has(rawKey)) {
      continue;
    }
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      continue;
    }

    const [field, op] = rawKey.split('__');
    const operator = op || 'eq';
    predicates.push({ field, operator, rawValue: String(rawValue) });
  }
  return predicates;
}

function applyQueryFilters(items, query) {
  const predicates = buildQueryPredicates(query);
  if (!predicates.length) {
    return items;
  }

  const useOr = String(query._or).toLowerCase() === 'true';
  return items.filter((item) => {
    const results = predicates.map(({ field, operator, rawValue }) => matchCondition(item, field, operator, rawValue));
    return useOr ? results.some(Boolean) : results.every(Boolean);
  });
}

function applyQuerySorting(items, query) {
  const sortField = query._sort;
  if (!sortField) {
    return items;
  }
  const order = String(query._order || 'asc').toLowerCase() === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => compareFieldValues(a[sortField], b[sortField]) * order);
}

function applyQueryPagination(items, query) {
  const limit = Number.isFinite(Number(query._limit)) ? Math.max(0, Number(query._limit)) : null;
  const offset = Number.isFinite(Number(query._offset)) ? Math.max(0, Number(query._offset)) : 0;
  if (limit === null && !query._offset) {
    return { data: items, total: items.length, limit: null, offset };
  }
  const paged = items.slice(offset, limit === null ? undefined : offset + limit);
  return { data: paged, total: items.length, limit, offset };
}

async function initializeDatabase() {
  await fs.promises.mkdir(dbDirectory, { recursive: true });
  await fs.promises.writeFile(resolvedDbPath, JSON.stringify(initialShape, null, 2), 'utf8');
  return { ...initialShape };
}

async function readDatabase() {
  try {
    const raw = await fs.promises.readFile(resolvedDbPath, 'utf8');
    if (!raw.trim()) {
      return initializeDatabase();
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return initializeDatabase();
    }

    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return initializeDatabase();
    }
    if (error instanceof SyntaxError) {
      return initializeDatabase();
    }
    throw error;
  }
}

const loadDatabase = readDatabase;

async function writeDatabase(db) {
  const tempPath = `${resolvedDbPath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(db, null, 2), 'utf8');
  await fs.promises.rename(tempPath, resolvedDbPath);
}

function enqueueWrite(work) {
  writeQueue = writeQueue.then(() => work(), () => work());
  return writeQueue;
}

async function performDbUpdate(updater) {
  return enqueueWrite(async () => {
    const db = await readDatabase();
    const result = await updater(db);
    await writeDatabase(db);
    return result;
  });
}

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/auth/register', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const created = await performDbUpdate(async (db) => {
      const users = ensureCollection(db, '_users');
      if (users.some((entry) => entry.username === username)) {
        return { conflict: true };
      }

      const role = users.length === 0 ? 'admin' : 'user';
      const { salt, hash } = hashPassword(password);
      const user = {
        id: generateId(),
        username,
        role,
        passwordHash: hash,
        passwordSalt: salt,
      };
      users.push(user);
      return { user };
    });

    if (created && created.conflict) {
      return res.status(409).json({ error: 'username already taken' });
    }

    return res.status(201).json({ user: safeUserResponse(created.user) });
  } catch (error) {
    next(error);
  }
});

app.post('/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const db = await readDatabase();
    const users = Array.isArray(db._users) ? db._users : [];
    const user = users.find((entry) => entry.username === username);
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ sub: user.id, username: user.username, role: user.role }, jwtSecret, {
      expiresIn: '1h',
    });

    return res.status(200).json({ token });
  } catch (error) {
    next(error);
  }
});

app.get('/auth/me', authenticate, (req, res) => {
  res.status(200).json(req.user);
});

app.get('/auth/users', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const db = await readDatabase();
    const users = Array.isArray(db._users) ? db._users : [];
    res.json({ users: users.map(safeUserResponse) });
  } catch (error) {
    next(error);
  }
});

app.patch('/auth/users/:id/role', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { role } = req.body || {};
    if (role !== 'admin' && role !== 'user') {
      return res.status(400).json({ error: 'role must be admin or user' });
    }

    const updated = await performDbUpdate(async (db) => {
      const users = ensureCollection(db, '_users');
      const index = users.findIndex((entry) => String(entry.id) === req.params.id);
      if (index === -1) {
        return null;
      }
      users[index] = { ...users[index], role };
      return users[index];
    });

    if (!updated) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json(safeUserResponse(updated));
  } catch (error) {
    next(error);
  }
});

app.post('/auth/teams', authenticate, async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const created = await performDbUpdate(async (db) => {
      const teams = ensureCollection(db, '_teams');
      const team = {
        id: generateId(),
        name,
        ownerId: req.user.id,
        members: [req.user.id],
      };
      teams.push(team);
      return team;
    });

    res.status(201).json({ team: created });
  } catch (error) {
    next(error);
  }
});

app.post('/auth/teams/:id/members', authenticate, async (req, res, next) => {
  try {
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const result = await performDbUpdate(async (db) => {
      const teams = ensureCollection(db, '_teams');
      const users = ensureCollection(db, '_users');
      const team = teams.find((entry) => String(entry.id) === req.params.id);
      if (!team) {
        return { missing: true };
      }

      const isOwner = String(team.ownerId) === req.user.id;
      if (!isAdmin(req) && !isOwner) {
        return { forbidden: true };
      }

      const userExists = users.some((entry) => String(entry.id) === String(userId));
      if (!userExists) {
        return { invalidUser: true };
      }

      const memberId = String(userId);
      team.members = Array.isArray(team.members) ? team.members : [];
      if (!team.members.some((member) => String(member) === memberId)) {
        team.members.push(memberId);
      }
      return { team };
    });

    if (result.missing) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (result.forbidden) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (result.invalidUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ team: result.team });
  } catch (error) {
    next(error);
  }
});

app.delete('/auth/teams/:id/members/:userId', authenticate, async (req, res, next) => {
  try {
    const result = await performDbUpdate(async (db) => {
      const teams = ensureCollection(db, '_teams');
      const team = teams.find((entry) => String(entry.id) === req.params.id);
      if (!team) {
        return { missing: true };
      }

      const isOwner = String(team.ownerId) === req.user.id;
      if (!isOwner) {
        return { forbidden: true };
      }

      if (String(team.ownerId) === String(req.params.userId)) {
        return { invalid: true };
      }

      team.members = Array.isArray(team.members)
        ? team.members.filter((member) => String(member) !== String(req.params.userId))
        : [];
      return { team };
    });

    if (result.missing) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (result.forbidden) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (result.invalid) {
      return res.status(400).json({ error: 'Cannot remove team owner' });
    }

    res.json({ team: result.team });
  } catch (error) {
    next(error);
  }
});

app.get('/auth/teams', authenticate, async (req, res, next) => {
  try {
    const db = await readDatabase();
    const teams = Array.isArray(db._teams) ? db._teams : [];
    const visible = teams.filter((team) =>
      Array.isArray(team.members) && team.members.some((member) => String(member) === req.user.id)
    );
    res.json({ teams: visible });
  } catch (error) {
    next(error);
  }
});

app.get('/auth/teams/:id', authenticate, async (req, res, next) => {
  try {
    const db = await readDatabase();
    const teams = Array.isArray(db._teams) ? db._teams : [];
    const team = teams.find((entry) => String(entry.id) === req.params.id);
    if (!team) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!Array.isArray(team.members) || !team.members.some((member) => String(member) === req.user.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ team });
  } catch (error) {
    next(error);
  }
});

app.patch('/auth/teams/:id', authenticate, async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const result = await performDbUpdate(async (db) => {
      const teams = ensureCollection(db, '_teams');
      const team = teams.find((entry) => String(entry.id) === req.params.id);
      if (!team) {
        return { missing: true };
      }
      if (String(team.ownerId) !== req.user.id) {
        return { forbidden: true };
      }
      team.name = name;
      return { team };
    });

    if (result.missing) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (result.forbidden) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ team: result.team });
  } catch (error) {
    next(error);
  }
});

app.delete('/auth/teams/:id', authenticate, async (req, res, next) => {
  try {
    const result = await performDbUpdate(async (db) => {
      const teams = ensureCollection(db, '_teams');
      const index = teams.findIndex((entry) => String(entry.id) === req.params.id);
      if (index === -1) {
        return { missing: true };
      }
      const team = teams[index];
      if (String(team.ownerId) !== req.user.id) {
        return { forbidden: true };
      }
      teams.splice(index, 1);
      return { deleted: true };
    });

    if (result.missing) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (result.forbidden) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.use('/:resource', authenticate, reservedCollection);

app.get('/:resource', async (req, res, next) => {
  try {
    const db = await readDatabase();
    const collection = Object.prototype.hasOwnProperty.call(db, req.params.resource)
      ? db[req.params.resource]
      : [];
    const items = Array.isArray(collection) ? collection : [];
    const visibleItems = filterVisibleItems(req, items, db);
    const filtered = applyQueryFilters(visibleItems, req.query);
    const sorted = applyQuerySorting(filtered, req.query);
    const { data, total, limit, offset } = applyQueryPagination(sorted, req.query);

    if (limit !== null || req.query._offset !== undefined) {
      return res.json({ data, total, limit, offset });
    }

    return res.json(data);
  } catch (error) {
    next(error);
  }
});

app.get('/:resource/:id', async (req, res, next) => {
  try {
    const db = await readDatabase();
    const collection = Object.prototype.hasOwnProperty.call(db, req.params.resource)
      ? db[req.params.resource]
      : [];

    const item = Array.isArray(collection)
      ? collection.find((entry) => String(entry.id) === req.params.id)
      : null;

    if (!item) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (!canReadItem(req, item, db)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(item);
  } catch (error) {
    next(error);
  }
});

app.post('/:resource', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Request body must be an object' });
    }

    const sharedWith = normalizeSharedWith(req.body.sharedWith);
    const sharedWithTeams = normalizeSharedWithTeams(req.body.sharedWithTeams);
    const created = await performDbUpdate(async (db) => {
      const collection = ensureCollection(db, req.params.resource);
      const item = {
        ...req.body,
        id: generateId(),
        ownerId: req.user.id,
        createdAt: currentTimestamp(),
        updatedAt: undefined,
        sharedWith,
        sharedWithTeams,
      };
      delete item.updatedAt;
      collection.push(item);
      return item;
    });

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

app.put('/:resource/:id', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Request body must be an object' });
    }

    const result = await performDbUpdate(async (db) => {
      const collection = ensureCollection(db, req.params.resource);
      const index = collection.findIndex((entry) => String(entry.id) === req.params.id);

      if (index === -1) {
        return { missing: true };
      }

      const currentItem = collection[index];
      if (!canWriteItem(req, currentItem, db)) {
        return { forbidden: true };
      }

      const sharedWith = req.body.hasOwnProperty('sharedWith')
        ? (currentItem.ownerId === req.user.id || isAdmin(req)
            ? normalizeSharedWith(req.body.sharedWith) ?? currentItem.sharedWith
            : currentItem.sharedWith)
        : currentItem.sharedWith;
      const sharedWithTeams = req.body.hasOwnProperty('sharedWithTeams')
        ? (currentItem.ownerId === req.user.id || isAdmin(req)
            ? normalizeSharedWithTeams(req.body.sharedWithTeams) ?? currentItem.sharedWithTeams
            : currentItem.sharedWithTeams)
        : currentItem.sharedWithTeams;

      const item = {
        ...req.body,
        id: currentItem.id,
        ownerId: currentItem.ownerId,
        createdAt: currentItem.createdAt,
        updatedAt: currentTimestamp(),
        sharedWith,
        sharedWithTeams,
      };
      collection[index] = item;
      return { item };
    });

    if (result.missing) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (result.forbidden) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(result.item);
  } catch (error) {
    next(error);
  }
});

app.patch('/:resource/:id', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Request body must be an object' });
    }

    const result = await performDbUpdate(async (db) => {
      const collection = ensureCollection(db, req.params.resource);
      const index = collection.findIndex((entry) => String(entry.id) === req.params.id);

      if (index === -1) {
        return { missing: true };
      }

      const currentItem = collection[index];
      if (!canWriteItem(req, currentItem, db)) {
        return { forbidden: true };
      }

      const sharedWith = req.body.hasOwnProperty('sharedWith')
        ? (currentItem.ownerId === req.user.id || isAdmin(req)
            ? normalizeSharedWith(req.body.sharedWith) ?? currentItem.sharedWith
            : currentItem.sharedWith)
        : currentItem.sharedWith;
      const sharedWithTeams = req.body.hasOwnProperty('sharedWithTeams')
        ? (currentItem.ownerId === req.user.id || isAdmin(req)
            ? normalizeSharedWithTeams(req.body.sharedWithTeams) ?? currentItem.sharedWithTeams
            : currentItem.sharedWithTeams)
        : currentItem.sharedWithTeams;

      const item = {
        ...currentItem,
        ...req.body,
        id: currentItem.id,
        ownerId: currentItem.ownerId,
        createdAt: currentItem.createdAt,
        updatedAt: currentTimestamp(),
        sharedWith,
        sharedWithTeams,
      };
      collection[index] = item;
      return { item };
    });

    if (result.missing) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (result.forbidden) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(result.item);
  } catch (error) {
    next(error);
  }
});

app.delete('/:resource/:id', async (req, res, next) => {
  try {
    const result = await performDbUpdate(async (db) => {
      const collection = ensureCollection(db, req.params.resource);
      const index = collection.findIndex((entry) => String(entry.id) === req.params.id);

      if (index === -1) {
        return { missing: true };
      }

      const currentItem = collection[index];
      if (!canDeleteItem(req, currentItem)) {
        return { forbidden: true };
      }

      collection.splice(index, 1);
      return { deleted: true };
    });

    if (result.missing) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (result.forbidden) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

loadDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
      console.log('running on');
    });
  })
  .catch((error) => {
    console.error('Failed to load database:', error);
    process.exit(1);
  });
