const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { saveDb } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'changeme-secret';
const RESERVED_COLLECTIONS = new Set(['_users', '_teams']);
const RESERVED_QUERY_PARAMS = new Set(['_sort', '_order', '_limit', '_offset', '_or']);

// Serial write queue — serializes all file writes to prevent corruption
let writeQueue = Promise.resolve();
function enqueueWrite(fn) {
  const result = writeQueue.then(fn);
  writeQueue = result.catch(() => {});
  return result;
}

// ── Query helpers ──────────────────────────────────────────────────────────────

function coerceValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  if (!isNaN(n) && raw.trim() !== '') return n;
  return raw;
}

function matchesFilter(item, field, op, rawValue) {
  const v = item[field];
  switch (op) {
    case 'eq':         return v == coerceValue(rawValue);
    case 'ne':         return v != coerceValue(rawValue);
    case 'gt':         return v > Number(rawValue);
    case 'gte':        return v >= Number(rawValue);
    case 'lt':         return v < Number(rawValue);
    case 'lte':        return v <= Number(rawValue);
    case 'between': {
      const [lo, hi] = rawValue.split(',').map(Number);
      return v >= lo && v <= hi;
    }
    case 'contains':   return String(v).toLowerCase().includes(rawValue.toLowerCase());
    case 'startswith': return String(v).toLowerCase().startsWith(rawValue.toLowerCase());
    case 'endswith':   return String(v).toLowerCase().endsWith(rawValue.toLowerCase());
    case 'in':         return rawValue.split(',').map(coerceValue).includes(v);
    default:           return true;
  }
}

function parseFilters(query) {
  return Object.entries(query)
    .filter(([k]) => !RESERVED_QUERY_PARAMS.has(k))
    .map(([key, rawValue]) => {
      const i = key.lastIndexOf('__');
      if (i === -1) return { field: key, op: 'eq', rawValue };
      return { field: key.slice(0, i), op: key.slice(i + 2), rawValue };
    });
}

function applyFilters(items, query) {
  const filters = parseFilters(query);
  if (!filters.length) return items;
  const useOr = query._or === 'true';
  return items.filter(item =>
    useOr
      ? filters.some(({ field, op, rawValue }) => matchesFilter(item, field, op, rawValue))
      : filters.every(({ field, op, rawValue }) => matchesFilter(item, field, op, rawValue))
  );
}

function applySort(items, query) {
  if (!query._sort) return items;
  const field = query._sort;
  const desc = query._order === 'desc';
  return [...items].sort((a, b) => {
    if (a[field] < b[field]) return desc ? 1 : -1;
    if (a[field] > b[field]) return desc ? -1 : 1;
    return 0;
  });
}

function applyPagination(items, query) {
  const hasPagination = query._limit !== undefined || query._offset !== undefined;
  if (!hasPagination) return { data: items, paginated: false };
  const total = items.length;
  const offset = Math.max(0, parseInt(query._offset || '0', 10) || 0);
  const limit = query._limit !== undefined ? Math.max(0, parseInt(query._limit, 10) || 0) : undefined;
  let data = items.slice(offset);
  if (limit !== undefined) data = data.slice(0, limit);
  return { data, total, limit: limit ?? data.length, offset, paginated: true };
}

// ── Access control ─────────────────────────────────────────────────────────────

function getItemAccess(item, user, teams) {
  if (user.role === 'admin') return 'admin';
  if (item.ownerId === user.id) return 'owner';

  const share = (item.sharedWith || []).find(s => s.userId === user.id);
  if (share) return share.access; // "read" | "write"

  const userTeamIds = new Set(teams.filter(t => t.members.includes(user.id)).map(t => t.id));
  const teamShare = (item.sharedWithTeams || []).find(s => userTeamIds.has(s.teamId));
  if (teamShare) return teamShare.access;

  return null;
}

// ── Server factory ─────────────────────────────────────────────────────────────

function createServer(db, dbPath) {
  const app = express();
  app.use(express.json());

  const persist = () => enqueueWrite(() => saveDb(dbPath, db));

  function requireAuth(req, res, next) {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    next();
  }

  // ── Health ──────────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // ── Auth ────────────────────────────────────────────────────────────────────

  app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    if (!db._users) db._users = [];
    if (db._users.find(u => u.username === username)) return res.status(409).json({ error: 'Username taken' });
    const role = db._users.length === 0 ? 'admin' : 'user';
    const passwordHash = await bcrypt.hash(password, 10);
    const user = { id: crypto.randomUUID(), username, passwordHash, role };
    db._users.push(user);
    await persist();
    res.status(201).json({ id: user.id, username: user.username, role: user.role });
  });

  app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const user = (db._users || []).find(u => u.username === username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token });
  });

  app.get('/auth/me', requireAuth, (req, res) => {
    res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
  });

  app.get('/auth/users', requireAuth, requireAdmin, (_req, res) => {
    const users = (db._users || []).map(({ id, username, role }) => ({ id, username, role }));
    res.json({ users });
  });

  app.patch('/auth/users/:id/role', requireAuth, requireAdmin, async (req, res) => {
    const { role } = req.body || {};
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'role must be "admin" or "user"' });
    const user = (db._users || []).find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.role = role;
    await persist();
    res.json({ id: user.id, username: user.username, role: user.role });
  });

  // ── Teams ────────────────────────────────────────────────────────────────────

  app.post('/auth/teams', requireAuth, async (req, res) => {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!db._teams) db._teams = [];
    const team = { id: crypto.randomUUID(), name, ownerId: req.user.id, members: [req.user.id] };
    db._teams.push(team);
    await persist();
    res.status(201).json({ team });
  });

  app.get('/auth/teams', requireAuth, (req, res) => {
    const teams = (db._teams || []).filter(t => t.members.includes(req.user.id));
    res.json({ teams });
  });

  app.get('/auth/teams/:id', requireAuth, (req, res) => {
    const team = (db._teams || []).find(t => t.id === req.params.id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (req.user.role !== 'admin' && !team.members.includes(req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    res.json({ team });
  });

  app.patch('/auth/teams/:id', requireAuth, async (req, res) => {
    const team = (db._teams || []).find(t => t.id === req.params.id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (req.user.role !== 'admin' && team.ownerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const { name } = req.body || {};
    if (name) team.name = name;
    await persist();
    res.json({ team });
  });

  app.delete('/auth/teams/:id', requireAuth, async (req, res) => {
    const idx = (db._teams || []).findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Team not found' });
    if (req.user.role !== 'admin' && db._teams[idx].ownerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    db._teams.splice(idx, 1);
    await persist();
    res.status(204).end();
  });

  app.post('/auth/teams/:id/members', requireAuth, async (req, res) => {
    const team = (db._teams || []).find(t => t.id === req.params.id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (req.user.role !== 'admin' && team.ownerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!(db._users || []).find(u => u.id === userId)) return res.status(404).json({ error: 'User not found' });
    if (!team.members.includes(userId)) team.members.push(userId);
    await persist();
    res.json({ team });
  });

  app.delete('/auth/teams/:id/members/:userId', requireAuth, async (req, res) => {
    const team = (db._teams || []).find(t => t.id === req.params.id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (req.user.role !== 'admin' && team.ownerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const memberIdx = team.members.indexOf(req.params.userId);
    if (memberIdx === -1) return res.status(404).json({ error: 'Member not found' });
    team.members.splice(memberIdx, 1);
    await persist();
    res.json({ team });
  });

  // ── Dynamic resource routes ──────────────────────────────────────────────────

  app.get('/:resource', requireAuth, (req, res) => {
    const { resource } = req.params;
    if (RESERVED_COLLECTIONS.has(resource)) return res.status(403).json({ error: 'Forbidden' });
    const collection = db[resource] || [];
    const teams = db._teams || [];
    let items = req.user.role === 'admin'
      ? collection
      : collection.filter(i => getItemAccess(i, req.user, teams) !== null);
    items = applyFilters(items, req.query);
    items = applySort(items, req.query);
    const { data, paginated, total, limit, offset } = applyPagination(items, req.query);
    if (paginated) return res.json({ data, total, limit, offset });
    res.json(data);
  });

  app.get('/:resource/:id', requireAuth, (req, res) => {
    const { resource, id } = req.params;
    if (RESERVED_COLLECTIONS.has(resource)) return res.status(403).json({ error: 'Forbidden' });
    const item = (db[resource] || []).find(i => i.id === id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const access = getItemAccess(item, req.user, db._teams || []);
    if (!access) return res.status(403).json({ error: 'Forbidden' });
    res.json(item);
  });

  app.post('/:resource', requireAuth, async (req, res) => {
    const { resource } = req.params;
    if (RESERVED_COLLECTIONS.has(resource)) return res.status(403).json({ error: 'Forbidden' });
    if (!db[resource]) db[resource] = [];
    const now = new Date().toISOString();
    const { id: _id, ownerId: _ownerId, createdAt: _createdAt, ...body } = req.body || {};
    const item = { ...body, id: crypto.randomUUID(), ownerId: req.user.id, createdAt: now };
    db[resource].push(item);
    await persist();
    res.status(201).json(item);
  });

  app.put('/:resource/:id', requireAuth, async (req, res) => {
    const { resource, id } = req.params;
    if (RESERVED_COLLECTIONS.has(resource)) return res.status(403).json({ error: 'Forbidden' });
    const collection = db[resource] || [];
    const idx = collection.findIndex(i => i.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const existing = collection[idx];
    const access = getItemAccess(existing, req.user, db._teams || []);
    if (!access || access === 'read') return res.status(403).json({ error: 'Forbidden' });
    const { id: _id, ownerId: _ownerId, createdAt: _createdAt, ...body } = req.body || {};
    const updated = {
      ...body,
      id: existing.id,
      ownerId: existing.ownerId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    collection[idx] = updated;
    await persist();
    res.json(updated);
  });

  app.patch('/:resource/:id', requireAuth, async (req, res) => {
    const { resource, id } = req.params;
    if (RESERVED_COLLECTIONS.has(resource)) return res.status(403).json({ error: 'Forbidden' });
    const collection = db[resource] || [];
    const idx = collection.findIndex(i => i.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const existing = collection[idx];
    const access = getItemAccess(existing, req.user, db._teams || []);
    if (!access || access === 'read') return res.status(403).json({ error: 'Forbidden' });
    const { id: _id, ownerId: _ownerId, createdAt: _createdAt, ...body } = req.body || {};
    const updated = {
      ...existing,
      ...body,
      id: existing.id,
      ownerId: existing.ownerId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    collection[idx] = updated;
    await persist();
    res.json(updated);
  });

  app.delete('/:resource/:id', requireAuth, async (req, res) => {
    const { resource, id } = req.params;
    if (RESERVED_COLLECTIONS.has(resource)) return res.status(403).json({ error: 'Forbidden' });
    const collection = db[resource] || [];
    const idx = collection.findIndex(i => i.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const existing = collection[idx];
    // Sharing grants no delete rights — only owner or admin
    if (req.user.role !== 'admin' && existing.ownerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    collection.splice(idx, 1);
    await persist();
    res.status(204).end();
  });

  return app;
}

module.exports = { createServer };
