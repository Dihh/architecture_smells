import express from "express";
import { randomUUID } from "node:crypto";
import { authenticateToken } from "./auth.js";
import { createAuthRouter } from "./authRoutes.js";
import { JsonDatabase } from "./db.js";

const PORT = process.env.PORT || 3000;
const databasePath = process.env.DB_PATH;
const db = new JsonDatabase(databasePath);
const reservedQueryKeys = new Set(["_sort", "_order", "_limit", "_offset", "_or"]);

await db.initialize();

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/auth", createAuthRouter(db));
app.use(authenticateToken);

app.get("/:resource", async (req, res, next) => {
  try {
    const items = await db.read((data) => {
      const collection = getCollection(data, req.params.resource);
      return req.user.role === "admin"
        ? collection
        : collection.filter((item) => canRead(req.user, item, data));
    });

    const result = applyQuery(items.map(sanitizeForResponse), req.query);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/:resource/:id", async (req, res, next) => {
  try {
    const itemResult = await db.read((data) => {
      const item = findById(getCollection(data, req.params.resource), req.params.id);
      return item ? { item, allowed: canRead(req.user, item, data) } : null;
    });

    if (!itemResult) {
      return res.status(404).json({ error: "Item not found" });
    }

    if (!itemResult.allowed) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.status(200).json(sanitizeForResponse(itemResult.item));
  } catch (error) {
    return next(error);
  }
});

app.post("/:resource", async (req, res, next) => {
  try {
    if (!isObject(req.body)) {
      return res.status(400).json({ error: "Request body must be a JSON object" });
    }

    const item = await db.write((data) => {
      const collection = getCollection(data, req.params.resource, { create: true });
      const now = new Date().toISOString();
      const item = {
        ...withoutSystemFields(req.body),
        sharedWith: normalizeSharedWith(req.body.sharedWith),
        sharedWithTeams: normalizeSharedWithTeams(req.body.sharedWithTeams),
        id: createUniqueId(collection),
        ownerId: req.user.id,
        createdAt: now
      };

      collection.push(item);
      data[req.params.resource] = collection;

      return item;
    });

    return res.status(201).json(sanitizeForResponse(item));
  } catch (error) {
    return next(error);
  }
});

app.put("/:resource/:id", async (req, res, next) => {
  try {
    if (!isObject(req.body)) {
      return res.status(400).json({ error: "Request body must be a JSON object" });
    }

    const result = await db.write((data) => {
      const collection = getCollection(data, req.params.resource);
      const index = findIndexById(collection, req.params.id);

      if (index === -1) {
        return { status: "not_found" };
      }

      const existing = collection[index];

      if (!canWrite(req.user, existing, data)) {
        return { status: "forbidden" };
      }

      const item = {
        ...withoutSystemFieldsAndSharing(req.body),
        sharedWith: existing.sharedWith,
        sharedWithTeams: existing.sharedWithTeams,
        id: existing.id,
        ownerId: existing.ownerId,
        createdAt: existing.createdAt,
        updatedAt: nextTimestampAfter(existing.createdAt)
      };

      collection[index] = item;

      return { status: "ok", item };
    });

    if (result.status === "not_found") {
      return res.status(404).json({ error: "Item not found" });
    }

    if (result.status === "forbidden") {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.status(200).json(sanitizeForResponse(result.item));
  } catch (error) {
    return next(error);
  }
});

app.patch("/:resource/:id", async (req, res, next) => {
  try {
    if (!isObject(req.body)) {
      return res.status(400).json({ error: "Request body must be a JSON object" });
    }

    const result = await db.write((data) => {
      const collection = getCollection(data, req.params.resource);
      const index = findIndexById(collection, req.params.id);

      if (index === -1) {
        return { status: "not_found" };
      }

      const existing = collection[index];

      if (!canWrite(req.user, existing, data)) {
        return { status: "forbidden" };
      }

      const attributes = withoutSystemFields(req.body);
      const canManageSharing = req.user.role === "admin" || isOwner(req.user, existing);
      const sharedWith = canManageSharing && Object.hasOwn(attributes, "sharedWith")
        ? normalizeSharedWith(attributes.sharedWith)
        : existing.sharedWith;
      const sharedWithTeams = canManageSharing && Object.hasOwn(attributes, "sharedWithTeams")
        ? normalizeSharedWithTeams(attributes.sharedWithTeams)
        : existing.sharedWithTeams;
      delete attributes.sharedWith;
      delete attributes.sharedWithTeams;

      const item = {
        ...existing,
        ...attributes,
        sharedWith,
        sharedWithTeams,
        id: existing.id,
        ownerId: existing.ownerId,
        createdAt: existing.createdAt,
        updatedAt: nextTimestampAfter(existing.createdAt)
      };

      collection[index] = item;

      return { status: "ok", item };
    });

    if (result.status === "not_found") {
      return res.status(404).json({ error: "Item not found" });
    }

    if (result.status === "forbidden") {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.status(200).json(sanitizeForResponse(result.item));
  } catch (error) {
    return next(error);
  }
});

app.delete("/:resource/:id", async (req, res, next) => {
  try {
    const result = await db.write((data) => {
      const collection = getCollection(data, req.params.resource);
      const index = findIndexById(collection, req.params.id);

      if (index === -1) {
        return { status: "not_found" };
      }

      if (!canDelete(req.user, collection[index])) {
        return { status: "forbidden" };
      }

      collection.splice(index, 1);

      return { status: "ok" };
    });

    if (result.status === "not_found") {
      return res.status(404).json({ error: "Item not found" });
    }

    if (result.status === "forbidden") {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  return res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeForResponse(item) {
  if (!isObject(item)) {
    return item;
  }

  const { password, passwordHash, ...safeItem } = item;
  return safeItem;
}

function getCollection(data, resource, options = {}) {
  if (!Array.isArray(data[resource]) && options.create) {
    data[resource] = [];
  }

  return Array.isArray(data[resource]) ? data[resource] : [];
}

function findById(collection, id) {
  return collection.find((item) => String(item.id) === String(id)) ?? null;
}

function findIndexById(collection, id) {
  return collection.findIndex((item) => String(item.id) === String(id));
}

function canRead(user, item, data) {
  return user.role === "admin" || isOwner(user, item) || sharedAccess(user, item, data) !== null;
}

function canWrite(user, item, data) {
  return user.role === "admin" || isOwner(user, item) || sharedAccess(user, item, data) === "write";
}

function canDelete(user, item) {
  return user.role === "admin" || isOwner(user, item);
}

function isOwner(user, item) {
  return String(item.ownerId) === String(user.id);
}

function withoutSystemFields(item) {
  const { id, ownerId, createdAt, updatedAt, ...attributes } = item;
  return attributes;
}

function withoutSystemFieldsAndSharing(item) {
  const { sharedWith, sharedWithTeams, ...attributes } = withoutSystemFields(item);
  return attributes;
}

function sharedAccess(user, item, data) {
  const grants = Array.isArray(item.sharedWith) ? item.sharedWith : [];
  const grant = grants.find((entry) => String(entry.userId) === String(user.id));
  const directAccess = grant?.access === "read" || grant?.access === "write" ? grant.access : null;
  const teamAccess = sharedTeamAccess(user, item, data);

  return strongestAccess(directAccess, teamAccess);
}

function normalizeSharedWith(sharedWith) {
  if (!Array.isArray(sharedWith)) {
    return [];
  }

  return sharedWith
    .filter((entry) => {
      return isObject(entry)
        && entry.userId !== undefined
        && (entry.access === "read" || entry.access === "write");
    })
    .map((entry) => ({
      userId: entry.userId,
      access: entry.access
    }));
}

function normalizeSharedWithTeams(sharedWithTeams) {
  if (!Array.isArray(sharedWithTeams)) {
    return [];
  }

  return sharedWithTeams
    .filter((entry) => {
      return isObject(entry)
        && entry.teamId !== undefined
        && (entry.access === "read" || entry.access === "write");
    })
    .map((entry) => ({
      teamId: entry.teamId,
      access: entry.access
    }));
}

function sharedTeamAccess(user, item, data) {
  const grants = Array.isArray(item.sharedWithTeams) ? item.sharedWithTeams : [];
  const teams = Array.isArray(data._teams) ? data._teams : [];
  let access = null;

  for (const grant of grants) {
    if (grant.access !== "read" && grant.access !== "write") {
      continue;
    }

    const team = teams.find((candidate) => String(candidate.id) === String(grant.teamId));

    if (team && isTeamMember(user, team)) {
      access = strongestAccess(access, grant.access);
    }
  }

  return access;
}

function isTeamMember(user, team) {
  return Array.isArray(team.members)
    && team.members.some((memberId) => String(memberId) === String(user.id));
}

function strongestAccess(first, second) {
  if (first === "write" || second === "write") {
    return "write";
  }

  if (first === "read" || second === "read") {
    return "read";
  }

  return null;
}

function applyQuery(items, query) {
  const conditions = buildConditions(query);
  const filteredItems = conditions.length > 0
    ? items.filter((item) => matchesConditions(item, conditions, query._or === "true"))
    : items;
  const sortedItems = sortItems(filteredItems, query._sort, query._order);
  const total = sortedItems.length;
  const pagination = parsePagination(query);

  if (!pagination.enabled) {
    return sortedItems;
  }

  const limit = pagination.limit ?? Math.max(0, total - pagination.offset);
  const data = sortedItems.slice(pagination.offset, pagination.offset + limit);

  return {
    data,
    total,
    limit,
    offset: pagination.offset
  };
}

function buildConditions(query) {
  return Object.entries(query)
    .filter(([key]) => !reservedQueryKeys.has(key))
    .map(([key, value]) => {
      const { field, operator } = parseFilterKey(key);
      return {
        field,
        operator,
        value: Array.isArray(value) ? value.at(-1) : value
      };
    });
}

function parseFilterKey(key) {
  const parts = key.split("__");

  if (parts.length === 1) {
    return { field: key, operator: "eq" };
  }

  return {
    field: parts.slice(0, -1).join("__"),
    operator: parts.at(-1)
  };
}

function matchesConditions(item, conditions, useOr) {
  const matches = conditions.map((condition) => matchesCondition(item, condition));
  return useOr ? matches.some(Boolean) : matches.every(Boolean);
}

function matchesCondition(item, condition) {
  const actual = item[condition.field];
  const expected = parseQueryValue(condition.value);

  switch (condition.operator) {
    case "eq":
      return valuesEqual(actual, expected);
    case "ne":
      return !valuesEqual(actual, expected);
    case "gt":
      return Number(actual) > Number(condition.value);
    case "gte":
      return Number(actual) >= Number(condition.value);
    case "lt":
      return Number(actual) < Number(condition.value);
    case "lte":
      return Number(actual) <= Number(condition.value);
    case "between":
      return matchesBetween(actual, condition.value);
    case "contains":
      return String(actual ?? "").toLowerCase().includes(String(condition.value).toLowerCase());
    case "startswith":
      return String(actual ?? "").toLowerCase().startsWith(String(condition.value).toLowerCase());
    case "endswith":
      return String(actual ?? "").toLowerCase().endsWith(String(condition.value).toLowerCase());
    case "in":
      return String(condition.value)
        .split(",")
        .map(parseQueryValue)
        .some((value) => valuesEqual(actual, value));
    default:
      return false;
  }
}

function valuesEqual(actual, expected) {
  if (typeof expected === "boolean") {
    return actual === expected;
  }

  return String(actual) === String(expected);
}

function parseQueryValue(value) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return value;
}

function matchesBetween(actual, value) {
  const [low, high] = String(value).split(",");
  const numericActual = Number(actual);

  return numericActual >= Number(low) && numericActual <= Number(high);
}

function sortItems(items, sortField, order = "asc") {
  if (!sortField) {
    return items;
  }

  const direction = order === "desc" ? -1 : 1;

  return [...items].sort((first, second) => {
    const firstValue = first[sortField];
    const secondValue = second[sortField];

    if (firstValue === secondValue) {
      return 0;
    }

    if (firstValue === undefined) {
      return 1;
    }

    if (secondValue === undefined) {
      return -1;
    }

    return firstValue > secondValue ? direction : -direction;
  });
}

function parsePagination(query) {
  const hasLimit = query._limit !== undefined;
  const hasOffset = query._offset !== undefined;
  const limit = hasLimit ? Math.max(0, Number.parseInt(query._limit, 10) || 0) : null;
  const offset = hasOffset ? Math.max(0, Number.parseInt(query._offset, 10) || 0) : 0;

  return {
    enabled: hasLimit || hasOffset,
    limit,
    offset
  };
}

function createUniqueId(collection) {
  let id = randomUUID();

  while (collection.some((item) => String(item.id) === id)) {
    id = randomUUID();
  }

  return id;
}

function nextTimestampAfter(createdAt) {
  const createdTime = Date.parse(createdAt);
  const now = new Date();

  if (Number.isNaN(createdTime) || now.getTime() > createdTime) {
    return now.toISOString();
  }

  return new Date(createdTime + 1).toISOString();
}
