import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const initialDatabase = {
  _users: [],
  _teams: []
};

export async function loadDatabase(databasePath) {
  if (!databasePath) {
    throw new Error("DB_PATH environment variable is required");
  }

  try {
    const contents = await readFile(databasePath, "utf8");

    if (contents.trim() === "") {
      await writeInitialDatabase(databasePath);
      return structuredClone(initialDatabase);
    }

    return JSON.parse(contents);
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeInitialDatabase(databasePath);
      return structuredClone(initialDatabase);
    }

    throw error;
  }
}

export class JsonDatabase {
  constructor(databasePath) {
    if (!databasePath) {
      throw new Error("DB_PATH environment variable is required");
    }

    this.databasePath = databasePath;
    this.queue = Promise.resolve();
  }

  async initialize() {
    await loadDatabase(this.databasePath);
  }

  all(resource) {
    return this.#run(async (data) => {
      return this.#collection(data, resource);
    });
  }

  find(resource, id) {
    return this.#run(async (data) => {
      const collection = this.#collection(data, resource);
      return collection.find((item) => String(item.id) === String(id)) ?? null;
    });
  }

  create(resource, attributes) {
    return this.#runWrite(async (data) => {
      const collection = this.#collection(data, resource, { create: true });
      const item = {
        ...attributes,
        id: this.#createUniqueId(collection)
      };

      collection.push(item);
      data[resource] = collection;

      return item;
    });
  }

  replace(resource, id, attributes) {
    return this.#runWrite(async (data) => {
      const collection = this.#collection(data, resource);
      const index = collection.findIndex((item) => String(item.id) === String(id));

      if (index === -1) {
        return null;
      }

      const item = {
        ...attributes,
        id
      };

      collection[index] = item;
      data[resource] = collection;

      return item;
    });
  }

  update(resource, id, attributes) {
    return this.#runWrite(async (data) => {
      const collection = this.#collection(data, resource);
      const index = collection.findIndex((item) => String(item.id) === String(id));

      if (index === -1) {
        return null;
      }

      const item = {
        ...collection[index],
        ...attributes,
        id: collection[index].id
      };

      collection[index] = item;
      data[resource] = collection;

      return item;
    });
  }

  delete(resource, id) {
    return this.#runWrite(async (data) => {
      const collection = this.#collection(data, resource);
      const index = collection.findIndex((item) => String(item.id) === String(id));

      if (index === -1) {
        return false;
      }

      collection.splice(index, 1);
      data[resource] = collection;

      return true;
    });
  }

  read(operation) {
    return this.#run(operation);
  }

  write(operation) {
    return this.#runWrite(operation);
  }

  #run(operation) {
    const next = this.queue.then(async () => {
      const data = await readDatabaseFile(this.databasePath);
      return operation(data);
    });

    this.queue = next.catch(() => {});
    return next;
  }

  #runWrite(operation) {
    const next = this.queue.then(async () => {
      const data = await readDatabaseFile(this.databasePath);
      const result = await operation(data);
      await writeDatabaseFile(this.databasePath, data);
      return result;
    });

    this.queue = next.catch(() => {});
    return next;
  }

  #collection(data, resource, options = {}) {
    if (!Array.isArray(data[resource]) && options.create) {
      data[resource] = [];
    }

    return Array.isArray(data[resource]) ? data[resource] : [];
  }

  #createUniqueId(collection) {
    let id = randomUUID();

    while (collection.some((item) => String(item.id) === id)) {
      id = randomUUID();
    }

    return id;
  }
}

async function readDatabaseFile(databasePath) {
  const contents = await readFile(databasePath, "utf8");

  if (contents.trim() === "") {
    await writeInitialDatabase(databasePath);
    return structuredClone(initialDatabase);
  }

  return JSON.parse(contents);
}

async function writeDatabaseFile(databasePath, data) {
  await mkdir(path.dirname(databasePath), { recursive: true });

  const temporaryPath = `${databasePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`);
  await rename(temporaryPath, databasePath);
}

async function writeInitialDatabase(databasePath) {
  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, `${JSON.stringify(initialDatabase, null, 2)}\n`);
}
