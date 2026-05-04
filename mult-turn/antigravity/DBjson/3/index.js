const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

const authorizeAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    next();
};

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => res.json({ status: "ok" }));

// Auth & Teams
app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.registerUser({ username, password: hashedPassword });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result);
});

app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await db.getUserByUsername(username);
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
});

app.get('/auth/me', authenticate, (req, res) => res.json(req.user));

app.get('/auth/users', authenticate, authorizeAdmin, async (req, res) => {
    const users = await db.getAll('_users');
    res.json(users.map(({ password, ...u }) => u));
});

app.patch('/auth/users/:id/role', authenticate, authorizeAdmin, async (req, res) => {
    const { role } = req.body;
    if (role !== 'admin' && role !== 'user') return res.status(400).json({ error: 'Invalid role' });
    const updated = await db.updateUserRole(req.params.id, role);
    if (!updated) return res.status(404).json({ error: 'User not found' });
    res.json(updated);
});

app.post('/auth/teams', authenticate, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Team name is required' });
    const team = await db.create('_teams', { name, ownerId: req.user.id, members: [req.user.id] });
    res.status(201).json(team);
});

app.get('/auth/teams', authenticate, async (req, res) => {
    const teams = await db.getAll('_teams');
    const myTeams = teams.filter(t => t.members.includes(req.user.id));
    res.json(myTeams);
});

app.get('/auth/teams/:id', authenticate, async (req, res) => {
    const team = await db.getById('_teams', req.params.id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (!team.members.includes(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    res.json(team);
});

app.patch('/auth/teams/:id', authenticate, async (req, res) => {
    const team = await db.getById('_teams', req.params.id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.ownerId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const updated = await db.update('_teams', req.params.id, { name: req.body.name }, true);
    res.json(updated);
});

app.delete('/auth/teams/:id', authenticate, async (req, res) => {
    const team = await db.getById('_teams', req.params.id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.ownerId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    await db.delete('_teams', req.params.id);
    res.json({ message: 'Team deleted' });
});

app.post('/auth/teams/:id/members', authenticate, async (req, res) => {
    const team = await db.getById('_teams', req.params.id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.ownerId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const newMembers = Array.from(new Set([...team.members, userId]));
    const updated = await db.update('_teams', req.params.id, { members: newMembers }, true);
    res.json(updated);
});

app.delete('/auth/teams/:id/members/:userId', authenticate, async (req, res) => {
    const team = await db.getById('_teams', req.params.id);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.ownerId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const newMembers = team.members.filter(m => m !== req.params.userId);
    const updated = await db.update('_teams', req.params.id, { members: newMembers }, true);
    res.json(updated);
});

// Dynamic routes logic
const checkReserved = (req, res, next) => {
    const { resource } = req.params;
    if (['_users', '_teams', 'auth'].includes(resource)) return res.status(403).json({ error: 'Reserved' });
    next();
};

const getAccess = (item, user, userTeams) => {
    if (user.role === 'admin' || item.ownerId === user.id) return 'owner';
    let access = 'none';
    const userShare = (item.sharedWith || []).find(s => s.userId === user.id);
    if (userShare) access = userShare.access;
    if (access === 'write') return 'write';
    const teamIds = userTeams.map(t => t.id);
    const teamShares = (item.sharedWithTeams || []).filter(s => teamIds.includes(s.teamId));
    if (teamShares.some(s => s.access === 'write')) return 'write';
    if (teamShares.some(s => s.access === 'read')) return 'read';
    return access;
};

const cast = (val) => {
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (!isNaN(val) && val !== '') return Number(val);
    return val;
};

const processQuery = (items, q) => {
    let result = [...items];
    const reserved = ['_or', '_sort', '_order', '_limit', '_offset'];
    
    // Filtering
    const filters = Object.entries(q).filter(([k]) => !reserved.includes(k));
    if (filters.length > 0) {
        const isOr = q._or === 'true';
        result = result.filter(item => {
            const matches = filters.map(([key, val]) => {
                let [field, op] = key.split('__');
                const itemVal = item[field];
                const target = cast(val);
                if (!op) return itemVal === target;
                switch (op) {
                    case 'ne': return itemVal !== target;
                    case 'gt': return Number(itemVal) > Number(val);
                    case 'gte': return Number(itemVal) >= Number(val);
                    case 'lt': return Number(itemVal) < Number(val);
                    case 'lte': return Number(itemVal) <= Number(val);
                    case 'between':
                        const [lo, hi] = val.split(',').map(Number);
                        return Number(itemVal) >= lo && Number(itemVal) <= hi;
                    case 'contains':
                        return String(itemVal).toLowerCase().includes(String(val).toLowerCase());
                    case 'startswith':
                        return String(itemVal).toLowerCase().startsWith(String(val).toLowerCase());
                    case 'endswith':
                        return String(itemVal).toLowerCase().endsWith(String(val).toLowerCase());
                    case 'in':
                        return val.split(',').map(v => cast(v)).includes(itemVal);
                    default: return true;
                }
            });
            return isOr ? matches.some(m => m) : matches.every(m => m);
        });
    }

    // Sorting
    if (q._sort) {
        const field = q._sort;
        const order = q._order === 'desc' ? -1 : 1;
        result.sort((a, b) => {
            if (a[field] < b[field]) return -1 * order;
            if (a[field] > b[field]) return 1 * order;
            return 0;
        });
    }

    // Pagination
    const total = result.length;
    const limit = q._limit !== undefined ? parseInt(q._limit) : undefined;
    const offset = q._offset !== undefined ? parseInt(q._offset) : 0;

    if (limit !== undefined || offset > 0) {
        return { 
            data: result.slice(offset, limit !== undefined ? offset + limit : undefined), 
            total, 
            limit: limit !== undefined ? limit : total, 
            offset 
        };
    }

    return result;
};

app.get('/:resource', authenticate, checkReserved, async (req, res) => {
    const allTeams = await db.getAll('_teams');
    const userTeams = allTeams.filter(t => t.members.includes(req.user.id));
    let items = await db.getAll(req.params.resource);
    if (req.user.role !== 'admin') items = items.filter(i => getAccess(i, req.user, userTeams) !== 'none');
    res.json(processQuery(items, req.query));
});

app.get('/:resource/:id', authenticate, checkReserved, async (req, res) => {
    const item = await db.getById(req.params.resource, req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const allTeams = await db.getAll('_teams');
    const userTeams = allTeams.filter(t => t.members.includes(req.user.id));
    if (getAccess(item, req.user, userTeams) === 'none') return res.status(403).json({ error: 'Forbidden' });
    res.json(item);
});

app.post('/:resource', authenticate, checkReserved, async (req, res) => {
    const newItem = await db.create(req.params.resource, { ...req.body, ownerId: req.user.id });
    res.status(201).json(newItem);
});

app.put('/:resource/:id', authenticate, checkReserved, async (req, res) => {
    const item = await db.getById(req.params.resource, req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const allTeams = await db.getAll('_teams');
    const userTeams = allTeams.filter(t => t.members.includes(req.user.id));
    const access = getAccess(item, req.user, userTeams);
    if (access !== 'owner' && access !== 'write') return res.status(403).json({ error: 'Forbidden' });
    const updateData = { ...req.body };
    if (access !== 'owner') { delete updateData.sharedWith; delete updateData.sharedWithTeams; }
    const updated = await db.update(req.params.resource, req.params.id, { ...updateData, ownerId: item.ownerId }, false);
    res.json(updated);
});

app.patch('/:resource/:id', authenticate, checkReserved, async (req, res) => {
    const item = await db.getById(req.params.resource, req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const allTeams = await db.getAll('_teams');
    const userTeams = allTeams.filter(t => t.members.includes(req.user.id));
    const access = getAccess(item, req.user, userTeams);
    if (access !== 'owner' && access !== 'write') return res.status(403).json({ error: 'Forbidden' });
    const updateData = { ...req.body };
    if (access !== 'owner') { delete updateData.sharedWith; delete updateData.sharedWithTeams; }
    const updated = await db.update(req.params.resource, req.params.id, updateData, true);
    res.json(updated);
});

app.delete('/:resource/:id', authenticate, checkReserved, async (req, res) => {
    const item = await db.getById(req.params.resource, req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (item.ownerId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    await db.delete(req.params.resource, req.params.id);
    res.json({ message: 'Deleted' });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
