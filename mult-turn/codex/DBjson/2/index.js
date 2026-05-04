const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DEFAULT_PORT = 3000;
const INITIAL_DB = { _users: [], _teams: [] };
const JWT_SECRET = process.env.JWT_SECRET || 'development-secret';
const PASSWORD_SALT_ROUNDS = 10;
const RESERVED_COLLECTIONS = new Set(['_users', '_teams']);
const ALLOWED_ROLES = new Set(['admin', 'user']);
const ALLOWED_SHARED_ACCESS = new Set(['read', 'write']);
const RESERVED_QUERY_KEYS = new Set(['_sort', '_order', '_limit', '_offset', '_or']);
const FILTER_OPERATORS = new Set([
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'contains',
  'startswith',
  'endswith',
  'in',
]);
const FORBIDDEN = Symbol('forbidden');
let databasePath;
let writeQueue = Promise.resolve();

function loadDatabase(dbPath) {
  if (!dbPath) {
    throw new Error('DB_PATH environment variable is required');
  }

  const resolvedPath = path.resolve(dbPath);
  databasePath = resolvedPath;
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  if (!fs.existsSync(resolvedPath) || fs.readFileSync(resolvedPath, 'utf8').trim() === '') {
    fs.writeFileSync(resolvedPath, `${JSON.stringify(INITIAL_DB, null, 2)}\n`);
    return INITIAL_DB;
  }

  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

async function readDatabase() {
  await writeQueue;
  const contents = await fs.promises.readFile(databasePath, 'utf8');
  return JSON.parse(contents);
}

async function writeDatabase(data) {
  const temporaryPath = `${databasePath}.${process.pid}.tmp`;
  const serialized = `${JSON.stringify(data, null, 2)}\n`;

  await fs.promises.writeFile(temporaryPath, serialized);
  await fs.promises.rename(temporaryPath, databasePath);
}

function updateDatabase(updater) {
  const operation = writeQueue.then(async () => {
    const contents = await fs.promises.readFile(databasePath, 'utf8');
    const data = JSON.parse(contents);
    const result = await updater(data);

    if (result?.write !== false) {
      await writeDatabase(data);
    }

    return result?.value;
  });

  writeQueue = operation.catch(() => {});
  return operation;
}

function getCollection(data, resource, createIfMissing = false) {
  if (!Array.isArray(data[resource])) {
    if (!createIfMissing) {
      return [];
    }

    data[resource] = [];
  }

  return data[resource];
}

function generateId(collection) {
  let id;

  do {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  } while (collection.some((item) => String(item.id) === id));

  return id;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
  };
}

function sanitizeItem(resource, item) {
  if (resource !== '_users' || !item) {
    return item;
  }

  const { password, passwordHash, ...safeUser } = item;
  return safeUser;
}

function sanitizeCollection(resource, collection) {
  return collection.map((item) => sanitizeItem(resource, item));
}

function isAdmin(user) {
  return user.role === 'admin';
}

function isOwner(user, item) {
  return item.ownerId === user.id;
}

function sharedGrant(user, item) {
  if (!Array.isArray(item.sharedWith)) {
    return null;
  }

  return item.sharedWith.find((grant) => grant.userId === user.id) || null;
}

function teamGrant(user, item, data) {
  if (!Array.isArray(item.sharedWithTeams)) {
    return null;
  }

  const teams = getCollection(data, '_teams');

  return (
    item.sharedWithTeams.find((grant) => {
      const team = teams.find((entry) => entry.id === grant.teamId);
      return team && Array.isArray(team.members) && team.members.includes(user.id);
    }) || null
  );
}

function canReadItem(user, item, data) {
  return isAdmin(user) || isOwner(user, item) || Boolean(sharedGrant(user, item) || teamGrant(user, item, data));
}

function canWriteItem(user, item, data) {
  const grant = sharedGrant(user, item);
  const team = teamGrant(user, item, data);
  return isAdmin(user) || isOwner(user, item) || grant?.access === 'write' || team?.access === 'write';
}

function canDeleteItem(user, item) {
  return isAdmin(user) || isOwner(user, item);
}

function canManageSharing(user, item) {
  return isAdmin(user) || isOwner(user, item);
}

function stripSystemFields(item) {
  const { id, ownerId, createdAt, updatedAt, ...clientFields } = item || {};
  return clientFields;
}

function normalizeSharedWith(sharedWith) {
  if (!Array.isArray(sharedWith)) {
    return [];
  }

  return sharedWith
    .filter(
      (grant) =>
        grant &&
        typeof grant.userId === 'string' &&
        ALLOWED_SHARED_ACCESS.has(grant.access)
    )
    .map((grant) => ({
      userId: grant.userId,
      access: grant.access,
    }));
}

function normalizeSharedWithTeams(sharedWithTeams) {
  if (!Array.isArray(sharedWithTeams)) {
    return [];
  }

  return sharedWithTeams
    .filter(
      (grant) =>
        grant &&
        typeof grant.teamId === 'string' &&
        ALLOWED_SHARED_ACCESS.has(grant.access)
    )
    .map((grant) => ({
      teamId: grant.teamId,
      access: grant.access,
    }));
}

function prepareCreatePayload(body) {
  const payload = stripSystemFields(body);

  if (Object.prototype.hasOwnProperty.call(payload, 'sharedWith')) {
    payload.sharedWith = normalizeSharedWith(payload.sharedWith);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'sharedWithTeams')) {
    payload.sharedWithTeams = normalizeSharedWithTeams(payload.sharedWithTeams);
  }

  return payload;
}

function prepareUpdatePayload(body, existing, user) {
  const payload = stripSystemFields(body);

  if (Object.prototype.hasOwnProperty.call(payload, 'sharedWith')) {
    if (canManageSharing(user, existing)) {
      payload.sharedWith = normalizeSharedWith(payload.sharedWith);
    } else {
      delete payload.sharedWith;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'sharedWithTeams')) {
    if (canManageSharing(user, existing)) {
      payload.sharedWithTeams = normalizeSharedWithTeams(payload.sharedWithTeams);
    } else {
      delete payload.sharedWithTeams;
    }
  }

  return payload;
}

function nextTimestampAfter(timestamp) {
  const now = new Date();

  if (now.toISOString() !== timestamp) {
    return now.toISOString();
  }

  return new Date(now.getTime() + 1).toISOString();
}

function authenticate(req, res, next) {
  const authHeader = req.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Bearer token is required' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();

  if (!token) {
    res.status(401).json({ error: 'Bearer token is required' });
    return;
  }

  try {
    req.user = publicUser(jwt.verify(token, JWT_SECRET));
    next();
  } catch (_error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  next();
}

function blockReservedCollection(req, res, next) {
  if (RESERVED_COLLECTIONS.has(req.params.resource)) {
    res.status(403).json({ error: 'Reserved collection' });
    return;
  }

  next();
}

function findTeam(data, teamId) {
  return getCollection(data, '_teams').find((team) => String(team.id) === teamId) || null;
}

function isTeamOwner(user, team) {
  return team.ownerId === user.id;
}

function isTeamMember(user, team) {
  return Array.isArray(team.members) && team.members.includes(user.id);
}

function coerceQueryValue(value) {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  if (value === 'null') {
    return null;
  }

  if (value !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }

  return value;
}

function parseFilterKey(key) {
  const parts = key.split('__');
  const possibleOperator = parts[parts.length - 1];

  if (parts.length > 1 && FILTER_OPERATORS.has(possibleOperator)) {
    return {
      field: parts.slice(0, -1).join('__'),
      operator: possibleOperator,
    };
  }

  return { field: key, operator: 'eq' };
}

function getComparableValue(item, field) {
  return item[field];
}

function compareValues(actual, expected) {
  return actual === expected || String(actual) === String(expected);
}

function numericValue(value) {
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

function matchesFilter(item, filter) {
  const actual = getComparableValue(item, filter.field);
  const expected = filter.value;

  switch (filter.operator) {
    case 'eq':
      return compareValues(actual, expected);
    case 'ne':
      return !compareValues(actual, expected);
    case 'gt':
      return numericValue(actual) !== null && numericValue(actual) > Number(expected);
    case 'gte':
      return numericValue(actual) !== null && numericValue(actual) >= Number(expected);
    case 'lt':
      return numericValue(actual) !== null && numericValue(actual) < Number(expected);
    case 'lte':
      return numericValue(actual) !== null && numericValue(actual) <= Number(expected);
    case 'between': {
      const [low, high] = filter.values.map(Number);
      const actualNumber = numericValue(actual);
      return actualNumber !== null && actualNumber >= low && actualNumber <= high;
    }
    case 'contains':
      return String(actual ?? '').toLowerCase().includes(String(expected).toLowerCase());
    case 'startswith':
      return String(actual ?? '').toLowerCase().startsWith(String(expected).toLowerCase());
    case 'endswith':
      return String(actual ?? '').toLowerCase().endsWith(String(expected).toLowerCase());
    case 'in':
      return filter.values.some((value) => compareValues(actual, value));
    default:
      return false;
  }
}

function parseFilters(query) {
  return Object.entries(query)
    .filter(([key]) => !RESERVED_QUERY_KEYS.has(key))
    .map(([key, rawValue]) => {
      const rawString = Array.isArray(rawValue) ? rawValue[rawValue.length - 1] : rawValue;
      const { field, operator } = parseFilterKey(key);
      const values = String(rawString)
        .split(',')
        .map((value) => coerceQueryValue(value));

      return {
        field,
        operator,
        value: coerceQueryValue(String(rawString)),
        values,
      };
    });
}

function applyFilters(items, query) {
  const filters = parseFilters(query);

  if (filters.length === 0) {
    return items;
  }

  const useOr = query._or === 'true';
  return items.filter((item) => {
    const results = filters.map((filter) => matchesFilter(item, filter));
    return useOr ? results.some(Boolean) : results.every(Boolean);
  });
}

function compareForSort(left, right) {
  if (left === right) {
    return 0;
  }

  if (left === undefined || left === null) {
    return 1;
  }

  if (right === undefined || right === null) {
    return -1;
  }

  const leftNumber = numericValue(left);
  const rightNumber = numericValue(right);

  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber;
  }

  return String(left).localeCompare(String(right));
}

function applySorting(items, query) {
  if (!query._sort) {
    return items;
  }

  const direction = query._order === 'desc' ? -1 : 1;
  return [...items].sort((left, right) => direction * compareForSort(left[query._sort], right[query._sort]));
}

function parseNonNegativeInteger(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    return fallback;
  }

  return number;
}

function applyQuery(items, query) {
  const filtered = applyFilters(items, query);
  const sorted = applySorting(filtered, query);
  const usesPagination = query._limit !== undefined || query._offset !== undefined;

  if (!usesPagination) {
    return sorted;
  }

  const total = sorted.length;
  const offset = parseNonNegativeInteger(query._offset, 0);
  const limit = parseNonNegativeInteger(query._limit, total);

  return {
    data: sorted.slice(offset, offset + limit),
    total,
    limit,
    offset,
  };
}

function createServer() {
  const app = express();

  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/auth/register', async (req, res, next) => {
    try {
      const { username, password } = req.body || {};

      if (!username || !password) {
        res.status(400).json({ error: 'Username and password are required' });
        return;
      }

      const user = await updateDatabase(async (data) => {
        const users = getCollection(data, '_users', true);
        const usernameTaken = users.some((entry) => entry.username === username);

        if (usernameTaken) {
          return { value: null, write: false };
        }

        const created = {
          id: generateId(users),
          username,
          passwordHash: await bcrypt.hash(password, PASSWORD_SALT_ROUNDS),
          role: users.length === 0 ? 'admin' : 'user',
        };

        users.push(created);
        return { value: publicUser(created) };
      });

      if (!user) {
        res.status(409).json({ error: 'Username already taken' });
        return;
      }

      res.status(201).json(user);
    } catch (error) {
      next(error);
    }
  });

  app.post('/auth/login', async (req, res, next) => {
    try {
      const { username, password } = req.body || {};

      if (!username || !password) {
        res.status(400).json({ error: 'Username and password are required' });
        return;
      }

      const data = await readDatabase();
      const users = getCollection(data, '_users');
      const user = users.find((entry) => entry.username === username);

      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        res.status(401).json({ error: 'Invalid username or password' });
        return;
      }

      const token = jwt.sign(publicUser(user), JWT_SECRET, { expiresIn: '1h' });

      res.status(200).json({ token });
    } catch (error) {
      next(error);
    }
  });

  app.get('/auth/me', authenticate, (req, res) => {
    res.status(200).json(req.user);
  });

  app.get('/auth/users', authenticate, requireAdmin, async (_req, res, next) => {
    try {
      const data = await readDatabase();
      const users = getCollection(data, '_users');

      res.status(200).json({ users: users.map(publicUser) });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/auth/users/:id/role', authenticate, requireAdmin, async (req, res, next) => {
    try {
      const { role } = req.body || {};

      if (!ALLOWED_ROLES.has(role)) {
        res.status(400).json({ error: 'Role must be admin or user' });
        return;
      }

      const user = await updateDatabase((data) => {
        const users = getCollection(data, '_users');
        const target = users.find((entry) => String(entry.id) === req.params.id);

        if (!target) {
          return { value: null, write: false };
        }

        target.role = role;
        return { value: publicUser(target) };
      });

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  });

  app.post('/auth/teams', authenticate, async (req, res, next) => {
    try {
      const { name } = req.body || {};

      if (!name) {
        res.status(400).json({ error: 'Team name is required' });
        return;
      }

      const team = await updateDatabase((data) => {
        const teams = getCollection(data, '_teams', true);
        const created = {
          id: generateId(teams),
          name,
          ownerId: req.user.id,
          members: [req.user.id],
        };

        teams.push(created);
        return { value: created };
      });

      res.status(201).json(team);
    } catch (error) {
      next(error);
    }
  });

  app.get('/auth/teams', authenticate, async (req, res, next) => {
    try {
      const data = await readDatabase();
      const teams = getCollection(data, '_teams').filter((team) => isTeamMember(req.user, team));

      res.status(200).json({ teams });
    } catch (error) {
      next(error);
    }
  });

  app.get('/auth/teams/:id', authenticate, async (req, res, next) => {
    try {
      const data = await readDatabase();
      const team = findTeam(data, req.params.id);

      if (!team) {
        res.status(404).json({ error: 'Team not found' });
        return;
      }

      if (!isTeamMember(req.user, team)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      res.status(200).json(team);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/auth/teams/:id', authenticate, async (req, res, next) => {
    try {
      const { name } = req.body || {};

      if (!name) {
        res.status(400).json({ error: 'Team name is required' });
        return;
      }

      const team = await updateDatabase((data) => {
        const target = findTeam(data, req.params.id);

        if (!target) {
          return { value: null, write: false };
        }

        if (!isTeamOwner(req.user, target)) {
          return { value: FORBIDDEN, write: false };
        }

        target.name = name;
        return { value: target };
      });

      if (team === FORBIDDEN) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      if (!team) {
        res.status(404).json({ error: 'Team not found' });
        return;
      }

      res.status(200).json(team);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/auth/teams/:id', authenticate, async (req, res, next) => {
    try {
      const deleted = await updateDatabase((data) => {
        const teams = getCollection(data, '_teams');
        const index = teams.findIndex((team) => String(team.id) === req.params.id);

        if (index === -1) {
          return { value: false, write: false };
        }

        if (!isTeamOwner(req.user, teams[index])) {
          return { value: FORBIDDEN, write: false };
        }

        teams.splice(index, 1);
        return { value: true };
      });

      if (deleted === FORBIDDEN) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      if (!deleted) {
        res.status(404).json({ error: 'Team not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.post('/auth/teams/:id/members', authenticate, async (req, res, next) => {
    try {
      const { userId } = req.body || {};

      if (!userId) {
        res.status(400).json({ error: 'User id is required' });
        return;
      }

      const team = await updateDatabase((data) => {
        const target = findTeam(data, req.params.id);

        if (!target) {
          return { value: null, write: false };
        }

        if (!isAdmin(req.user) && !isTeamOwner(req.user, target)) {
          return { value: FORBIDDEN, write: false };
        }

        if (!Array.isArray(target.members)) {
          target.members = [];
        }

        if (!target.members.includes(userId)) {
          target.members.push(userId);
        }

        return { value: target };
      });

      if (team === FORBIDDEN) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      if (!team) {
        res.status(404).json({ error: 'Team not found' });
        return;
      }

      res.status(200).json(team);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/auth/teams/:id/members/:userId', authenticate, async (req, res, next) => {
    try {
      const team = await updateDatabase((data) => {
        const target = findTeam(data, req.params.id);

        if (!target) {
          return { value: null, write: false };
        }

        if (!isTeamOwner(req.user, target)) {
          return { value: FORBIDDEN, write: false };
        }

        if (!Array.isArray(target.members)) {
          target.members = [];
        }

        target.members = target.members.filter((memberId) => memberId !== req.params.userId);
        return { value: target };
      });

      if (team === FORBIDDEN) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      if (!team) {
        res.status(404).json({ error: 'Team not found' });
        return;
      }

      res.status(200).json(team);
    } catch (error) {
      next(error);
    }
  });

  app.get('/:resource', authenticate, blockReservedCollection, async (req, res, next) => {
    try {
      const data = await readDatabase();
      const collection = getCollection(data, req.params.resource);
      const visibleItems = isAdmin(req.user)
        ? collection
        : collection.filter((item) => canReadItem(req.user, item, data));
      const queriedItems = applyQuery(visibleItems, req.query);

      if (Array.isArray(queriedItems)) {
        res.status(200).json(sanitizeCollection(req.params.resource, queriedItems));
        return;
      }

      res.status(200).json({
        ...queriedItems,
        data: sanitizeCollection(req.params.resource, queriedItems.data),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/:resource/:id', authenticate, blockReservedCollection, async (req, res, next) => {
    try {
      const data = await readDatabase();
      const collection = getCollection(data, req.params.resource);
      const item = collection.find((entry) => String(entry.id) === req.params.id);

      if (!item) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      if (!canReadItem(req.user, item, data)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      res.status(200).json(sanitizeItem(req.params.resource, item));
    } catch (error) {
      next(error);
    }
  });

  app.post('/:resource', authenticate, blockReservedCollection, async (req, res, next) => {
    try {
      const item = await updateDatabase((data) => {
        const collection = getCollection(data, req.params.resource, true);
        const createdAt = new Date().toISOString();
        const created = {
          ...prepareCreatePayload(req.body),
          id: generateId(collection),
          ownerId: req.user.id,
          createdAt,
        };

        collection.push(created);
        return { value: created };
      });

      res.status(201).json(sanitizeItem(req.params.resource, item));
    } catch (error) {
      next(error);
    }
  });

  app.put('/:resource/:id', authenticate, blockReservedCollection, async (req, res, next) => {
    try {
      const item = await updateDatabase((data) => {
        const collection = getCollection(data, req.params.resource);
        const index = collection.findIndex((entry) => String(entry.id) === req.params.id);

        if (index === -1) {
          return { value: null, write: false };
        }

        const existing = collection[index];

        if (!canWriteItem(req.user, existing, data)) {
          return { value: FORBIDDEN, write: false };
        }

        const replacement = {
          ...prepareUpdatePayload(req.body, existing, req.user),
          id: existing.id,
          ownerId: existing.ownerId,
          createdAt: existing.createdAt,
          updatedAt: nextTimestampAfter(existing.createdAt),
        };

        if (!canManageSharing(req.user, existing) && Object.prototype.hasOwnProperty.call(existing, 'sharedWith')) {
          replacement.sharedWith = existing.sharedWith;
        }

        if (!canManageSharing(req.user, existing) && Object.prototype.hasOwnProperty.call(existing, 'sharedWithTeams')) {
          replacement.sharedWithTeams = existing.sharedWithTeams;
        }

        collection[index] = replacement;
        return { value: replacement };
      });

      if (item === FORBIDDEN) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      if (!item) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      res.status(200).json(sanitizeItem(req.params.resource, item));
    } catch (error) {
      next(error);
    }
  });

  app.patch('/:resource/:id', authenticate, blockReservedCollection, async (req, res, next) => {
    try {
      const item = await updateDatabase((data) => {
        const collection = getCollection(data, req.params.resource);
        const index = collection.findIndex((entry) => String(entry.id) === req.params.id);

        if (index === -1) {
          return { value: null, write: false };
        }

        const existing = collection[index];

        if (!canWriteItem(req.user, existing, data)) {
          return { value: FORBIDDEN, write: false };
        }

        const updated = {
          ...existing,
          ...prepareUpdatePayload(req.body, existing, req.user),
          id: existing.id,
          ownerId: existing.ownerId,
          createdAt: existing.createdAt,
          updatedAt: nextTimestampAfter(existing.createdAt),
        };

        collection[index] = updated;
        return { value: updated };
      });

      if (item === FORBIDDEN) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      if (!item) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      res.status(200).json(sanitizeItem(req.params.resource, item));
    } catch (error) {
      next(error);
    }
  });

  app.delete('/:resource/:id', authenticate, blockReservedCollection, async (req, res, next) => {
    try {
      const deleted = await updateDatabase((data) => {
        const collection = getCollection(data, req.params.resource);
        const index = collection.findIndex((entry) => String(entry.id) === req.params.id);

        if (index === -1) {
          return { value: false, write: false };
        }

        if (!canDeleteItem(req.user, collection[index])) {
          return { value: FORBIDDEN, write: false };
        }

        collection.splice(index, 1);
        return { value: true };
      });

      if (deleted === FORBIDDEN) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      if (!deleted) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return app;
}

const port = process.env.PORT || DEFAULT_PORT;

loadDatabase(process.env.DB_PATH);

const app = createServer();
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
