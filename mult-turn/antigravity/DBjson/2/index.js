const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { initializeDB, getData, saveData } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

app.use(express.json());

// Initialize DB on startup
initializeDB();

app.get('/health', (req, res) => {
    res.status(200).json({ status: "ok" });
});

// Auth Routes
app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    
    const db = await getData();
    const users = db._users || [];
    
    if (users.find(u => u.username === username)) {
        return res.status(409).json({ error: 'Username already taken' });
    }
    
    const role = users.length === 0 ? 'admin' : 'user';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const newUser = {
        id: crypto.randomUUID(),
        username,
        password: hashedPassword,
        role
    };
    
    db._users.push(newUser);
    await saveData(db);
    
    const { password: _, ...userResponse } = newUser;
    res.status(201).json(userResponse);
});

app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    
    const db = await getData();
    const user = (db._users || []).find(u => u.username === username);
    
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '1h' }
    );
    
    res.json({ token });
});

// Middleware
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

// Profile Route
app.get('/auth/me', authenticate, (req, res) => {
    res.json(req.user);
});

// Admin Middleware
const authorizeAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Access denied: Admin only' });
    }
};

// Admin Routes
app.get('/auth/users', authenticate, authorizeAdmin, async (req, res) => {
    const db = await getData();
    const users = (db._users || []).map(({ password, ...user }) => user);
    res.json(users);
});

app.patch('/auth/users/:id/role', authenticate, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    
    if (!['admin', 'user'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }
    
    const db = await getData();
    const index = (db._users || []).findIndex(u => u.id === id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    db._users[index].role = role;
    await saveData(db);
    
    const { password, ...updatedUser } = db._users[index];
    res.json(updatedUser);
});

// Team Routes
app.post('/auth/teams', authenticate, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Team name is required' });
    
    const db = await getData();
    const newTeam = {
        id: crypto.randomUUID(),
        name,
        ownerId: req.user.id,
        members: [req.user.id]
    };
    
    if (!db._teams) db._teams = [];
    db._teams.push(newTeam);
    await saveData(db);
    
    res.status(201).json(newTeam);
});

app.get('/auth/teams', authenticate, async (req, res) => {
    const db = await getData();
    const teams = (db._teams || []).filter(t => t.members.includes(req.user.id) || req.user.role === 'admin');
    res.json(teams);
});

app.get('/auth/teams/:id', authenticate, async (req, res) => {
    const { id } = req.params;
    const db = await getData();
    const team = (db._teams || []).find(t => t.id === id);
    
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (!team.members.includes(req.user.id) && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json(team);
});

app.post('/auth/teams/:id/members', authenticate, async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    const db = await getData();
    const team = (db._teams || []).find(t => t.id === id);
    
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.ownerId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied: Only owner or admin can add members' });
    }
    
    if (!team.members.includes(userId)) {
        team.members.push(userId);
        await saveData(db);
    }
    
    res.json(team);
});

app.delete('/auth/teams/:id/members/:userId', authenticate, async (req, res) => {
    const { id, userId } = req.params;
    const db = await getData();
    const team = (db._teams || []).find(t => t.id === id);
    
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.ownerId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    team.members = team.members.filter(m => m !== userId);
    await saveData(db);
    
    res.json(team);
});

app.patch('/auth/teams/:id', authenticate, async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    const db = await getData();
    const team = (db._teams || []).find(t => t.id === id);
    
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.ownerId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    team.name = name || team.name;
    await saveData(db);
    
    res.json(team);
});

app.delete('/auth/teams/:id', authenticate, async (req, res) => {
    const { id } = req.params;
    const db = await getData();
    const index = (db._teams || []).findIndex(t => t.id === id);
    
    if (index === -1) return res.status(404).json({ error: 'Team not found' });
    
    const team = db._teams[index];
    if (team.ownerId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    db._teams.splice(index, 1);
    await saveData(db);
    
    res.status(200).json({ message: 'Team deleted' });
});

// Helper for dynamic routes access control
const checkResourceAccess = (item, user, db, requiredAccess = 'read') => {
    if (user.role === 'admin') return true;
    if (item.ownerId === user.id) return true;

    // Check individual sharing
    const userSharing = (item.sharedWith || []).find(s => s.userId === user.id);
    if (userSharing) {
        if (requiredAccess === 'read') return true;
        if (requiredAccess === 'write' && userSharing.access === 'write') return true;
    }

    // Check team sharing
    const userTeams = (db._teams || []).filter(t => t.members.includes(user.id)).map(t => t.id);
    const teamSharing = (item.sharedWithTeams || []).find(st => userTeams.includes(st.teamId));
    if (teamSharing) {
        if (requiredAccess === 'read') return true;
        if (requiredAccess === 'write' && teamSharing.access === 'write') return true;
    }

    return false;
};

// Advanced Query Helper
const applyAdvancedQuery = (items, query) => {
    const reserved = ['_sort', '_order', '_limit', '_offset', '_or'];
    const isOr = query._or === 'true';
    
    let filtered = items;
    
    const filterKeys = Object.keys(query).filter(k => !reserved.includes(k));
    
    if (filterKeys.length > 0) {
        filtered = items.filter(item => {
            const matches = filterKeys.map(key => {
                let [field, operator] = key.split('__');
                let targetValue = query[key];
                let itemValue = item[field];
                
                // Boolean conversion
                if (targetValue === 'true') targetValue = true;
                if (targetValue === 'false') targetValue = false;
                
                // Numeric conversion if possible
                if (!isNaN(targetValue) && typeof targetValue === 'string' && targetValue.trim() !== '') {
                    targetValue = Number(targetValue);
                }
                
                if (operator === 'ne') return itemValue !== targetValue;
                if (operator === 'gt') return Number(itemValue) > Number(targetValue);
                if (operator === 'gte') return Number(itemValue) >= Number(targetValue);
                if (operator === 'lt') return Number(itemValue) < Number(targetValue);
                if (operator === 'lte') return Number(itemValue) <= Number(targetValue);
                if (operator === 'between') {
                    const [lo, hi] = targetValue.split(',').map(Number);
                    return Number(itemValue) >= lo && Number(itemValue) <= hi;
                }
                if (operator === 'contains') return String(itemValue).toLowerCase().includes(String(targetValue).toLowerCase());
                if (operator === 'startswith') return String(itemValue).toLowerCase().startsWith(String(targetValue).toLowerCase());
                if (operator === 'endswith') return String(itemValue).toLowerCase().endsWith(String(targetValue).toLowerCase());
                if (operator === 'in') return targetValue.split(',').includes(String(itemValue));
                
                // Default: equality
                return itemValue === targetValue;
            });
            
            return isOr ? matches.some(m => m) : matches.every(m => m);
        });
    }
    
    const total = filtered.length;
    
    // Sorting
    if (query._sort) {
        const field = query._sort;
        const order = query._order === 'desc' ? -1 : 1;
        filtered.sort((a, b) => {
            if (a[field] < b[field]) return -1 * order;
            if (a[field] > b[field]) return 1 * order;
            return 0;
        });
    }
    
    // Pagination
    const limit = query._limit ? parseInt(query._limit) : null;
    const offset = query._offset ? parseInt(query._offset) : 0;
    
    if (limit !== null || offset > 0) {
        const start = offset;
        const end = limit !== null ? start + limit : filtered.length;
        const data = filtered.slice(start, end);
        return { data, total, limit: limit || total, offset };
    }
    
    return filtered;
};

// GET /:resource
app.get('/:resource', authenticate, async (req, res) => {
    const { resource } = req.params;
    if (resource.startsWith('_')) {
        return res.status(403).json({ error: 'Access to reserved collections is forbidden' });
    }
    const db = await getData();
    let collection = db[resource] || [];
    
    if (req.user.role !== 'admin') {
        const userTeams = (db._teams || []).filter(t => t.members.includes(req.user.id)).map(t => t.id);
        collection = collection.filter(item => 
            item.ownerId === req.user.id || 
            (item.sharedWith && item.sharedWith.some(s => s.userId === req.user.id)) ||
            (item.sharedWithTeams && item.sharedWithTeams.some(st => userTeams.includes(st.teamId)))
        );
    }
    
    const result = applyAdvancedQuery(collection, req.query);
    res.json(result);
});

// GET /:resource/:id
app.get('/:resource/:id', authenticate, async (req, res) => {
    const { resource, id } = req.params;
    if (resource.startsWith('_')) {
        return res.status(403).json({ error: 'Access to reserved collections is forbidden' });
    }
    const db = await getData();
    const collection = db[resource] || [];
    const item = collection.find(i => i.id === id);
    
    if (!item) return res.status(404).json({ error: 'Not found' });
    
    if (!checkResourceAccess(item, req.user, db, 'read')) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json(item);
});

// POST /:resource
app.post('/:resource', authenticate, async (req, res) => {
    const { resource } = req.params;
    if (resource.startsWith('_')) {
        return res.status(403).json({ error: 'Access to reserved collections is forbidden' });
    }
    const db = await getData();
    
    if (!db[resource]) db[resource] = [];
    
    const now = new Date().toISOString();
    const newItem = {
        ...req.body,
        id: crypto.randomUUID(),
        ownerId: req.user.id,
        createdAt: now,
        updatedAt: now
    };
    
    db[resource].push(newItem);
    await saveData(db);
    
    res.status(201).json(newItem);
});

// PUT /:resource/:id
app.put('/:resource/:id', authenticate, async (req, res) => {
    const { resource, id } = req.params;
    if (resource.startsWith('_')) {
        return res.status(403).json({ error: 'Access to reserved collections is forbidden' });
    }
    const db = await getData();
    const collection = db[resource] || [];
    const index = collection.findIndex(i => i.id === id);
    
    if (index === -1) return res.status(404).json({ error: 'Not found' });
    
    const item = db[resource][index];
    if (!checkResourceAccess(item, req.user, db, 'write')) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    const updatedItem = { 
        ...req.body, 
        id: item.id, 
        ownerId: item.ownerId, 
        createdAt: item.createdAt,
        updatedAt: new Date().toISOString()
    };
    
    db[resource][index] = updatedItem;
    await saveData(db);
    
    res.json(updatedItem);
});

// PATCH /:resource/:id
app.patch('/:resource/:id', authenticate, async (req, res) => {
    const { resource, id } = req.params;
    if (resource.startsWith('_')) {
        return res.status(403).json({ error: 'Access to reserved collections is forbidden' });
    }
    const db = await getData();
    const collection = db[resource] || [];
    const index = collection.findIndex(i => i.id === id);
    
    if (index === -1) return res.status(404).json({ error: 'Not found' });
    
    const item = db[resource][index];
    if (!checkResourceAccess(item, req.user, db, 'write')) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    const updatedItem = { 
        ...item, 
        ...req.body, 
        id: item.id, 
        ownerId: item.ownerId, 
        createdAt: item.createdAt,
        updatedAt: new Date().toISOString()
    };
    
    db[resource][index] = updatedItem;
    await saveData(db);
    
    res.json(updatedItem);
});

// DELETE /:resource/:id
app.delete('/:resource/:id', authenticate, async (req, res) => {
    const { resource, id } = req.params;
    if (resource.startsWith('_')) {
        return res.status(403).json({ error: 'Access to reserved collections is forbidden' });
    }
    const db = await getData();
    const collection = db[resource] || [];
    const index = collection.findIndex(i => i.id === id);
    
    if (index === -1) return res.status(404).json({ error: 'Not found' });
    
    const item = db[resource][index];
    // Only owner or admin can delete
    if (item.ownerId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied: Only owner or admin can delete' });
    }
    
    db[resource].splice(index, 1);
    await saveData(db);
    
    res.status(200).json({ message: 'Deleted successfully' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
