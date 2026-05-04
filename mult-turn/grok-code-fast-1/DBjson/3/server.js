const express = require('express');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Mutex } = require('async-mutex');

const app = express();

const dbMutex = new Mutex();

function matches(item, filter) {
  const { field, op, value } = filter;
  let itemVal = item[field];
  let val = value;
  // type conversion
  if (typeof itemVal === 'boolean') {
    val = value === 'true';
  } else if (typeof itemVal === 'number') {
    val = parseFloat(value);
  }
  switch (op) {
    case 'eq': return itemVal == val;
    case 'ne': return itemVal != val;
    case 'gt': return itemVal > val;
    case 'gte': return itemVal >= val;
    case 'lt': return itemVal < val;
    case 'lte': return itemVal <= val;
    case 'between':
      const [lo, hi] = value.split(',').map(parseFloat);
      return itemVal >= lo && itemVal <= hi;
    case 'contains':
      return String(itemVal).toLowerCase().includes(value.toLowerCase());
    case 'startswith':
      return String(itemVal).toLowerCase().startsWith(value.toLowerCase());
    case 'endswith':
      return String(itemVal).toLowerCase().endsWith(value.toLowerCase());
    case 'in':
      const list = value.split(',');
      return list.includes(String(itemVal));
    default: return false;
  }
}

function applyQueryFilters(items, query) {
  let filtered = items;
  const filters = [];
  const orMode = query._or === 'true';
  for (const [key, value] of Object.entries(query)) {
    if (['_sort', '_order', '_limit', '_offset', '_or'].includes(key)) continue;
    const parts = key.split('__');
    const field = parts[0];
    const op = parts[1] || 'eq';
    filters.push({ field, op, value });
  }
  if (orMode) {
    filtered = items.filter(item => filters.some(f => matches(item, f)));
  } else {
    filtered = items.filter(item => filters.every(f => matches(item, f)));
  }
  // sort
  if (query._sort) {
    const order = query._order === 'desc' ? -1 : 1;
    filtered.sort((a, b) => {
      const aVal = a[query._sort];
      const bVal = b[query._sort];
      if (aVal < bVal) return -1 * order;
      if (aVal > bVal) return 1 * order;
      return 0;
    });
  }
  // paginate
  const total = filtered.length;
  const offset = parseInt(query._offset) || 0;
  const limit = parseInt(query._limit) || filtered.length;
  const data = filtered.slice(offset, offset + limit);
  if (query._limit || query._offset) {
    return { data, total, limit, offset };
  } else {
    return data;
  }
}

const port = process.env.PORT || 3000;
const dbPath = process.env.DB_PATH;

if (!dbPath) {
  console.error('DB_PATH environment variable is required');
  process.exit(1);
}

let db;
try {
  const data = fs.readFileSync(dbPath, 'utf8');
  if (data.trim() === '') {
    db = { "users": [], "teams": [], "_users": [] };
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  } else {
    db = JSON.parse(data);
    db._teams = db._teams || [];
    if (!db.users) db.users = [];
    if (!db.teams) db.teams = [];
    if (!db._users) db._users = [];
    // Add ownership to existing items
    for (const key in db) {
      if (Array.isArray(db[key])) {
        db[key].forEach(item => {
          if (!item.ownerId) item.ownerId = 1; // Assume admin owns existing
          if (!item.createdAt) item.createdAt = new Date().toISOString();
        });
      }
    }
  }
} catch (err) {
  if (err.code === 'ENOENT') {
    db = { "users": [], "teams": [], "_users": [] };
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  } else {
    throw err;
  }
}

app.use(express.json());

// Auth middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, 'secret');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

app.get('/health', (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Auth routes
app.post('/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const existing = db._users.find(u => u.username === username);
  if (existing) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const role = db._users.length === 0 ? 'admin' : 'user';
  const maxId = db._users.length > 0 ? Math.max(...db._users.map(u => u.id)) : 0;
  const newUser = { id: maxId + 1, username, password: hashedPassword, role };
  db._users.push(newUser);
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  res.status(201).json({ id: newUser.id, username: newUser.username, role: newUser.role });
});

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db._users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, 'secret', { expiresIn: '1h' });
  res.json({ token });
});

app.get('/auth/me', authMiddleware, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

app.post('/auth/teams', authMiddleware, async (req, res) => {
  await dbMutex.runExclusive(async () => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const maxId = db._teams.length > 0 ? Math.max(...db._teams.map(t => t.id)) : 0;
    const newTeam = { id: maxId + 1, name, ownerId: req.user.id, members: [req.user.id] };
    db._teams.push(newTeam);
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    res.status(201).json(newTeam);
  });
});

app.get('/auth/teams', authMiddleware, (req, res) => {
  const userTeams = db._teams.filter(t => t.members.includes(req.user.id));
  res.json({ teams: userTeams });
});

app.get('/auth/teams/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const team = db._teams.find(t => t.id == id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!team.members.includes(req.user.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(team);
});

app.post('/auth/teams/:id/members', authMiddleware, async (req, res) => {
  await dbMutex.runExclusive(async () => {
    const { id } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const team = db._teams.find(t => t.id == id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (req.user.role !== 'admin' && team.ownerId != req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!team.members.includes(userId)) {
      team.members.push(userId);
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    }
    res.json(team);
  });
});

app.patch('/auth/teams/:id', authMiddleware, async (req, res) => {
  await dbMutex.runExclusive(async () => {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const team = db._teams.find(t => t.id == id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.ownerId != req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    team.name = name;
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    res.json(team);
  });
});

app.delete('/auth/teams/:id/members/:userId', authMiddleware, async (req, res) => {
  await dbMutex.runExclusive(async () => {
    const { id, userId } = req.params;
    const team = db._teams.find(t => t.id == id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.ownerId != req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    team.members = team.members.filter(m => m != userId);
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    res.json(team);
  });
});

app.delete('/auth/teams/:id', authMiddleware, async (req, res) => {
  await dbMutex.runExclusive(async () => {
    const { id } = req.params;
    const index = db._teams.findIndex(t => t.id == id);
    if (index === -1) return res.status(404).json({ error: 'Team not found' });
    const team = db._teams[index];
    if (team.ownerId != req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    db._teams.splice(index, 1);
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    res.status(204).send();
  });
});

app.get('/auth/users', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const users = db._users.map(u => ({ id: u.id, username: u.username, role: u.role }));
  res.json({ users });
});

app.patch('/auth/users/:id/role', authMiddleware, async (req, res) => {
  await dbMutex.runExclusive(async () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.params;
    const { role } = req.body;
    if (role !== 'admin' && role !== 'user') return res.status(400).json({ error: 'Invalid role' });
    const user = db._users.find(u => u.id == id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.role = role;
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    res.json({ id: user.id, username: user.username, role: user.role });
  });
});

// Dynamic resource routes
app.get('/:resource', authMiddleware, (req, res) => {
  const { resource } = req.params;
  if (resource === '_users' || resource === '_teams') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!db[resource]) db[resource] = [];
  let accessibleItems;
  if (req.user.role === 'admin') {
    accessibleItems = db[resource];
  } else {
    const owned = db[resource].filter(i => i.ownerId == req.user.id);
    const userShared = db[resource].filter(i => i.sharedWith && i.sharedWith.some(s => s.userId == req.user.id));
    const userTeamIds = db._teams.filter(t => t.members.includes(req.user.id)).map(t => t.id);
    const teamShared = db[resource].filter(i => i.sharedWithTeams && i.sharedWithTeams.some(s => userTeamIds.includes(s.teamId)));
    const all = [...owned, ...userShared, ...teamShared];
    accessibleItems = all.filter((item, index, arr) => arr.findIndex(i => i.id === item.id) === index);
  }
  const result = applyQueryFilters(accessibleItems, req.query);
  res.json(result);
});

app.get('/:resource/:id', authMiddleware, (req, res) => {
  const { resource, id } = req.params;
  if (resource === '_users' || resource === '_teams') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!db[resource]) db[resource] = [];
  const item = db[resource].find(i => i.id == id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'admin' || item.ownerId == req.user.id) {
    res.json(item);
  } else if (item.sharedWith && item.sharedWith.some(s => s.userId == req.user.id)) {
    res.json(item);
  } else {
    const userTeamIds = db._teams.filter(t => t.members.includes(req.user.id)).map(t => t.id);
    if (item.sharedWithTeams && item.sharedWithTeams.some(s => userTeamIds.includes(s.teamId))) {
      res.json(item);
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
});

app.post('/:resource', authMiddleware, async (req, res) => {
  await dbMutex.runExclusive(async () => {
    const { resource } = req.params;
    if (resource === '_users' || resource === '_teams') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!db[resource]) db[resource] = [];
    const newItem = { ...req.body };
    // Remove system fields from client input
    delete newItem.id;
    delete newItem.ownerId;
    delete newItem.createdAt;
    delete newItem.updatedAt;
    const maxId = db[resource].length > 0 ? Math.max(...db[resource].map(i => i.id)) : 0;
    newItem.id = maxId + 1;
    newItem.ownerId = req.user.id;
    newItem.createdAt = new Date().toISOString();
    db[resource].push(newItem);
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    res.status(201).json(newItem);
  });
});

app.put('/:resource/:id', authMiddleware, (req, res) => {
  const { resource, id } = req.params;
  if (resource === '_users' || resource === '_teams') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!db[resource]) db[resource] = [];
  const index = db[resource].findIndex(i => i.id == id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  const item = db[resource][index];
  let hasAccess = req.user.role === 'admin' || item.ownerId == req.user.id;
  if (!hasAccess && item.sharedWith && item.sharedWith.some(s => s.userId == req.user.id && s.access === 'write')) {
    hasAccess = true;
  }
  if (!hasAccess) {
    const userTeamIds = db._teams.filter(t => t.members.includes(req.user.id)).map(t => t.id);
    if (item.sharedWithTeams && item.sharedWithTeams.some(s => userTeamIds.includes(s.teamId) && s.access === 'write')) {
      hasAccess = true;
    }
  }
  if (!hasAccess) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const updates = { ...req.body };
  // Protect system fields
  delete updates.id;
  delete updates.ownerId;
  delete updates.createdAt;
  // Preserve original values
  updates.updatedAt = new Date().toISOString();
  db[resource][index] = { ...item, ...updates };
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  res.json(db[resource][index]);
});

app.patch('/:resource/:id', authMiddleware, async (req, res) => {
  await dbMutex.runExclusive(async () => {
    const { resource, id } = req.params;
    if (resource === '_users' || resource === '_teams') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!db[resource]) db[resource] = [];
    const index = db[resource].findIndex(i => i.id == id);
    if (index === -1) return res.status(404).json({ error: 'Not found' });
    const item = db[resource][index];
    let hasAccess = req.user.role === 'admin' || item.ownerId == req.user.id;
    if (!hasAccess && item.sharedWith && item.sharedWith.some(s => s.userId == req.user.id && s.access === 'write')) {
      hasAccess = true;
    }
    if (!hasAccess) {
      const userTeamIds = db._teams.filter(t => t.members.includes(req.user.id)).map(t => t.id);
      if (item.sharedWithTeams && item.sharedWithTeams.some(s => userTeamIds.includes(s.teamId) && s.access === 'write')) {
        hasAccess = true;
      }
    }
    if (!hasAccess) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const updates = { ...req.body };
    // Protect system fields
    delete updates.id;
    delete updates.ownerId;
    delete updates.createdAt;
    Object.assign(db[resource][index], updates);
    db[resource][index].updatedAt = new Date().toISOString();
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    res.json(db[resource][index]);
  });
});

app.delete('/:resource/:id', authMiddleware, async (req, res) => {
  await dbMutex.runExclusive(async () => {
    const { resource, id } = req.params;
    if (resource === '_users' || resource === '_teams') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!db[resource]) db[resource] = [];
    const index = db[resource].findIndex(i => i.id == id);
    if (index === -1) return res.status(404).json({ error: 'Not found' });
    const item = db[resource][index];
    if (req.user.role !== 'admin' && item.ownerId != req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    db[resource].splice(index, 1);
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    res.status(204).send();
  });
});

app.listen(port, () => {
  console.log(`running on port ${port}`);
});