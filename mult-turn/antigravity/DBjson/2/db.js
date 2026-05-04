const fs = require('fs').promises;
const path = require('path');

const DB_PATH = process.env.DB_PATH;

async function initializeDB() {
    if (!DB_PATH) {
        console.error('DB_PATH environment variable is not set.');
        process.exit(1);
    }

    const defaultData = { "_users": [], "_teams": [] };

    try {
        await fs.access(DB_PATH);
    } catch {
        await fs.writeFile(DB_PATH, JSON.stringify(defaultData, null, 2));
        return defaultData;
    }

    const content = await fs.readFile(DB_PATH, 'utf-8');
    if (!content || content.trim() === '') {
        await fs.writeFile(DB_PATH, JSON.stringify(defaultData, null, 2));
        return defaultData;
    }

    try {
        return JSON.parse(content);
    } catch (err) {
        console.error('Error parsing DB file:', err);
        process.exit(1);
    }
}

// Simple async queue to serialize DB operations
let queue = Promise.resolve();

function runQueued(operation) {
    queue = queue.then(operation).catch(err => {
        console.error('DB Queue Error:', err);
        throw err;
    });
    return queue;
}

async function getData() {
    return runQueued(async () => {
        const content = await fs.readFile(DB_PATH, 'utf-8');
        return JSON.parse(content);
    });
}

async function saveData(data) {
    return runQueued(async () => {
        await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
    });
}

module.exports = { initializeDB, getData, saveData };
