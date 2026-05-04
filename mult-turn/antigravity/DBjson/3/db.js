const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH;

class DbManager {
    constructor() {
        this.lock = Promise.resolve();
    }

    async _runTask(task) {
        const result = this.lock.then(task);
        this.lock = result.catch(() => {});
        return result;
    }

    read() {
        if (!fs.existsSync(DB_PATH)) {
            return { "_users": [], "_teams": [] };
        }
        try {
            const content = fs.readFileSync(DB_PATH, 'utf8');
            return content ? JSON.parse(content) : { "_users": [], "_teams": [] };
        } catch (e) {
            return { "_users": [], "_teams": [] };
        }
    }

    write(data) {
        const dbDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    }

    async getAll(resource) {
        return await this._runTask(async () => {
            const db = this.read();
            return db[resource] || [];
        });
    }

    async getById(resource, id) {
        return await this._runTask(async () => {
            const db = this.read();
            const collection = db[resource] || [];
            return collection.find(item => item.id === id);
        });
    }

    async create(resource, data) {
        return await this._runTask(async () => {
            const db = this.read();
            if (!db[resource]) {
                db[resource] = [];
            }
            const now = new Date().toISOString();
            const newItem = { 
                ...data, 
                id: crypto.randomUUID(),
                createdAt: now,
                updatedAt: now
            };
            db[resource].push(newItem);
            this.write(db);
            return newItem;
        });
    }

    async update(resource, id, data, partial = false) {
        return await this._runTask(async () => {
            const db = this.read();
            const collection = db[resource] || [];
            const index = collection.findIndex(item => item.id === id);
            if (index === -1) return null;

            const existingItem = collection[index];
            const now = new Date().toISOString();
            
            if (partial) {
                collection[index] = { 
                    ...existingItem, 
                    ...data, 
                    id, 
                    ownerId: existingItem.ownerId, 
                    createdAt: existingItem.createdAt,
                    updatedAt: now
                };
            } else {
                collection[index] = { 
                    ...data, 
                    id, 
                    ownerId: existingItem.ownerId, 
                    createdAt: existingItem.createdAt,
                    updatedAt: now
                };
            }

            db[resource] = collection;
            this.write(db);
            return collection[index];
        });
    }

    async delete(resource, id) {
        return await this._runTask(async () => {
            const db = this.read();
            const collection = db[resource] || [];
            const index = collection.findIndex(item => item.id === id);
            if (index === -1) return false;

            collection.splice(index, 1);
            db[resource] = collection;
            this.write(db);
            return true;
        });
    }
    async getUserByUsername(username) {
        return await this._runTask(async () => {
            const db = this.read();
            const users = db["_users"] || [];
            return users.find(u => u.username === username);
        });
    }

    async registerUser(userData) {
        return await this._runTask(async () => {
            const db = this.read();
            if (!db["_users"]) {
                db["_users"] = [];
            }
            
            const users = db["_users"];
            if (users.some(u => u.username === userData.username)) {
                return { error: 'Conflict', status: 409 };
            }

            const role = users.length === 0 ? 'admin' : 'user';
            const newUser = {
                ...userData,
                id: crypto.randomUUID(),
                role
            };

            users.push(newUser);
            this.write(db);
            
            // Return user without password
            const { password, ...userWithoutPassword } = newUser;
            return userWithoutPassword;
        });
    }
    async updateUserRole(id, newRole) {
        return await this._runTask(async () => {
            const db = this.read();
            const users = db["_users"] || [];
            const index = users.findIndex(u => u.id === id);
            if (index === -1) return null;

            users[index].role = newRole;
            this.write(db);
            
            const { password, ...userWithoutPassword } = users[index];
            return userWithoutPassword;
        });
    }
}

module.exports = new DbManager();
