require('dotenv').config();
const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;
const dbPath = process.env.DB_PATH;
const jwtSecret = process.env.JWT_SECRET || 'secret';

if (!dbPath) {
  console.error('DB_PATH environment variable is required');
  process.exit(1);
}

if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify({ "_users": [], "_teams": [] }, null, 2));
}

const loadDb = () => {
  try {
    const data = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return { "_users": [], "_teams": [] };
  }
};

const saveDb = (db) => {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
};

const writeQueue = [];
let isProcessing = false;

const processQueue = () => {
  if (isProcessing || writeQueue.length === 0) return;
  isProcessing = true;
  const task = writeQueue.shift();
  task();
  isProcessing = false;
  if (writeQueue.length > 0) {
    setImmediate(processQueue);
  }
};

const saveDbQueued = (db) => {
  writeQueue.push(() => {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  });
  processQueue();
};

app.use(express.json());

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

app.get('/health', (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post('/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const db = loadDb();
  const existing = db._users.find(u => u.username === username);
  if (existing) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  const role = db._users.length === 0 ? 'admin' : 'user';
  const id = crypto.randomUUID();
  const user = { id, username, password, role };
  db._users.push(user);
  saveDbQueued(db);
  res.status(201).json({ id, username, role });
});

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const db = loadDb();
  const user = db._users.find(u => u.username === username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, jwtSecret);
  res.json({ token });
});

app.get('/auth/me', authMiddleware, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

app.get('/auth/users', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const db = loadDb();
  const users = db._users.map(u => ({ id: u.id, username: u.username, role: u.role }));
  res.json({ users });
});

app.patch('/auth/users/:id/role', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { id } = req.params;
  const { role } = req.body;
  if (role !== 'admin' && role !== 'user') {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const db = loadDb();
  const user = db._users.find(u => u.id === id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  user.role = role;
  saveDb(db);
  res.json({ id, username: user.username, role });
});

app.post('/auth/teams', authMiddleware, (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const db = loadDb();
  const id = crypto.randomUUID();
  const team = { id, name, ownerId: req.user.id, members: [req.user.id] };
  db._teams.push(team);
  saveDbQueued(db);
  res.status(201).json(team);
});

app.post('/auth/teams/:id/members', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  const db = loadDb();
  const team = db._teams.find(t => t.id === id);
  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }
  if (req.user.role !== 'admin' && team.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!team.members.includes(userId)) {
    team.members.push(userId);
  }
  saveDbQueued(db);
  res.json(team);
});

app.delete('/auth/teams/:id/members/:userId', authMiddleware, (req, res) => {
  const { id, userId } = req.params;
  const db = loadDb();
  const team = db._teams.find(t => t.id === id);
  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }
  if (team.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  team.members = team.members.filter(m => m !== userId);
  saveDbQueued(db);
  res.json(team);
});

app.get('/auth/teams', authMiddleware, (req, res) => {
  const db = loadDb();
  const teams = db._teams.filter(t => t.members.includes(req.user.id));
  res.json(teams);
});

app.get('/auth/teams/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const db = loadDb();
  const team = db._teams.find(t => t.id === id);
  if (!team || !team.members.includes(req.user.id)) {
    return res.status(404).json({ error: 'Team not found' });
  }
  res.json(team);
});

app.patch('/auth/teams/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const db = loadDb();
  const team = db._teams.find(t => t.id === id);
  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }
  if (team.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  team.name = name;
  saveDbQueued(db);
  res.json(team);
});

app.delete('/auth/teams/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const db = loadDb();
  const index = db._teams.findIndex(t => t.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Team not found' });
  }
  const team = db._teams[index];
  if (team.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  db._teams.splice(index, 1);
  saveDb(db);
  res.status(204).send();
});

// Dynamic routes
app.get('/:resource', authMiddleware, (req, res) => {
  const resource = req.params.resource;
  if (resource === '_users' || resource === '_teams') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const db = loadDb();
  let items = db[resource] || [];
  if (req.user.role !== 'admin') {
    const userTeams = db._teams.filter(t => t.members.includes(req.user.id)).map(t => t.id);
    items = items.filter(item => 
      item.ownerId === req.user.id || 
      (item.sharedWith && item.sharedWith.some(s => s.userId === req.user.id)) ||
      (item.sharedWithTeams && item.sharedWithTeams.some(s => userTeams.includes(s.teamId)))
    );
  }
  // Apply query filters
  const query = req.query;
  const filters = [];
  const orMode = query._or === 'true';
  for (const key in query) {
    if (['_sort', '_order', '_limit', '_offset', '_or'].includes(key)) continue;
    const value = query[key];
    if (key.includes('__')) {
      const [field, op] = key.split('__');
      filters.push({ field, op, value });
    } else {
      filters.push({ field: key, op: 'eq', value });
    }
  }
  if (filters.length > 0) {
    items = items.filter(item => {
      const results = filters.map(f => {
        const val = item[f.field];
        switch (f.op) {
          case 'eq': return val == f.value || (f.value === 'false' && val === false) || (f.value === 'true' && val === true);
          case 'ne': return val != f.value;
          case 'gt': return Number(val) > Number(f.value);
          case 'gte': return Number(val) >= Number(f.value);
          case 'lt': return Number(val) < Number(f.value);
          case 'lte': return Number(val) <= Number(f.value);
          case 'between': const [lo, hi] = f.value.split(','); return Number(val) >= Number(lo) && Number(val) <= Number(hi);
          case 'contains': return val && val.toLowerCase().includes(f.value.toLowerCase());
          case 'startswith': return val && val.toLowerCase().startsWith(f.value.toLowerCase());
          case 'endswith': return val && val.toLowerCase().endsWith(f.value.toLowerCase());
          case 'in': return f.value.split(',').includes(val);
          default: return false;
        }
      });
      return orMode ? results.some(r => r) : results.every(r => r);
    });
  }
  // Sort
  const sortField = query._sort;
  if (sortField) {
    const order = query._order === 'desc' ? -1 : 1;
    items.sort((a, b) => {
      if (a[sortField] < b[sortField]) return -1 * order;
      if (a[sortField] > b[sortField]) return 1 * order;
      return 0;
    });
  }
  // Paginate
  const limit = parseInt(query._limit);
  const offset = parseInt(query._offset) || 0;
  const total = items.length;
  if (limit || offset) {
    items = items.slice(offset, limit ? offset + limit : undefined);
  }
  if (limit || offset) {
    res.json({ data: items, total, limit, offset });
  } else {
    res.json(items);
  }
});

app.get('/:resource/:id', authMiddleware, (req, res) => {
  const { resource, id } = req.params;
  if (resource === '_users' || resource === '_teams') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const db = loadDb();
  const items = db[resource] || [];
  const item = items.find(i => i.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin') {
    const userTeams = db._teams.filter(t => t.members.includes(req.user.id)).map(t => t.id);
    const hasAccess = item.ownerId === req.user.id || 
      (item.sharedWith && item.sharedWith.some(s => s.userId === req.user.id)) ||
      (item.sharedWithTeams && item.sharedWithTeams.some(s => userTeams.includes(s.teamId)));
    if (!hasAccess) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  res.json(item);
});

app.post('/:resource', authMiddleware, (req, res) => {
  const resource = req.params.resource;
  if (resource === '_users' || resource === '_teams') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const db = loadDb();
  db[resource] = db[resource] || [];
  const newItem = { 
    ...req.body, 
    id: crypto.randomUUID(),
    ownerId: req.user.id,
    createdAt: new Date().toISOString()
  };
  db[resource].push(newItem);
  saveDbQueued(db);
  res.status(201).json(newItem);
});

app.put('/:resource/:id', authMiddleware, (req, res) => {
  const { resource, id } = req.params;
  if (resource === '_users' || resource === '_teams') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const db = loadDb();
  const items = db[resource] || [];
  const index = items.findIndex(i => i.id === id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  const item = items[index];
  if (req.user.role !== 'admin') {
    const userTeams = db._teams.filter(t => t.members.includes(req.user.id)).map(t => t.id);
    const hasWriteAccess = item.ownerId === req.user.id || 
      (item.sharedWith && item.sharedWith.some(s => s.userId === req.user.id && s.access === 'write')) ||
      (item.sharedWithTeams && item.sharedWithTeams.some(s => userTeams.includes(s.teamId) && s.access === 'write'));
    if (!hasWriteAccess) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  const updatedItem = { 
    ...req.body, 
    id: item.id,
    ownerId: item.ownerId,
    createdAt: item.createdAt,
    updatedAt: new Date().toISOString()
  };
  items[index] = updatedItem;
  saveDbQueued(db);
  res.json(updatedItem);
});

app.patch('/:resource/:id', authMiddleware, (req, res) => {
  const { resource, id } = req.params;
  if (resource === '_users' || resource === '_teams') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const db = loadDb();
  const items = db[resource] || [];
  const index = items.findIndex(i => i.id === id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  const item = items[index];
  if (req.user.role !== 'admin') {
    const userTeams = db._teams.filter(t => t.members.includes(req.user.id)).map(t => t.id);
    const hasWriteAccess = item.ownerId === req.user.id || 
      (item.sharedWith && item.sharedWith.some(s => s.userId === req.user.id && s.access === 'write')) ||
      (item.sharedWithTeams && item.sharedWithTeams.some(s => userTeams.includes(s.teamId) && s.access === 'write'));
    if (!hasWriteAccess) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  Object.assign(item, req.body);
  item.id = id;
  item.ownerId = item.ownerId;
  item.createdAt = item.createdAt;
  item.updatedAt = new Date().toISOString();
  saveDbQueued(db);
  res.json(item);
});

app.delete('/:resource/:id', authMiddleware, (req, res) => {
  const { resource, id } = req.params;
  if (resource === '_users' || resource === '_teams') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const db = loadDb();
  const items = db[resource] || [];
  const index = items.findIndex(i => i.id === id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  const item = items[index];
  if (req.user.role !== 'admin' && item.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  items.splice(index, 1);
  saveDbQueued(db);
  res.status(204).send();
});

app.listen(port, () => {
  console.log('running on');
});