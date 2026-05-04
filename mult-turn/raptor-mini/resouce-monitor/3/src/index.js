import http from "http";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import {
  initMetrics,
  getCpuMetrics,
  getMemoryMetrics,
  getDiskMetrics,
  getUptimeMetrics,
  getMetricsSnapshot,
} from "./metrics.js";

const app = express();
const server = http.createServer(app);
const port = process.env.PORT ? Number(process.env.PORT) : 3001;
const validMetricTypes = new Set(["cpu", "memory", "disk", "uptime"]);
const clients = new Set();
const validWsTypes = ["all", "cpu", "memory", "disk", "uptime"];
const websocketSubscriptions = new Map([
  ["/ws", []],
  ["/ws/", []],
  ["/ws/cpu", ["cpu"]],
  ["/ws/memory", ["memory"]],
  ["/ws/disk", ["disk"]],
  ["/ws/uptime", ["uptime"]],
  ["/ws/all", ["cpu", "memory", "disk", "uptime"]],
]);

app.use((req, res, next) => {
  res.type("application/json");
  next();
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/metrics", (req, res) => {
  const snapshot = getMetricsSnapshot();
  res.status(200).json(snapshot);
});

app.get("/metrics/:type", (req, res) => {
  const { type } = req.params;
  if (!validMetricTypes.has(type)) {
    return res.status(400).json({ error: `Invalid metric type: ${type}` });
  }

  let metrics = null;
  switch (type) {
    case "cpu":
      metrics = getCpuMetrics();
      break;
    case "memory":
      metrics = getMemoryMetrics();
      break;
    case "disk":
      metrics = getDiskMetrics();
      break;
    case "uptime":
      metrics = getUptimeMetrics();
      break;
  }

  res.status(200).json(metrics);
});

app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

const wss = new WebSocketServer({ noServer: true });

function normalizeWsPath(path) {
  if (!path) return "/ws";
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function buildSnapshotForSubscription(subscribedTo) {
  const snapshot = getMetricsSnapshot();
  const result = { timestamp: snapshot.timestamp };

  for (const type of subscribedTo) {
    if (snapshot[type] !== undefined) {
      result[type] = snapshot[type];
    }
  }

  return result;
}

function sendError(socket, message) {
  try {
    socket.send(JSON.stringify({ event: "error", message }));
  } catch (error) {
    // ignore send errors for error messages
  }
}

function normalizeMetrics(metrics) {
  if (!Array.isArray(metrics)) {
    return { validTypes: [], invalidTypes: [], empty: true };
  }

  if (metrics.length === 0) {
    return { validTypes: [], invalidTypes: [], empty: true };
  }

  const requested = new Set();
  const invalidTypes = new Set();

  for (const rawType of metrics) {
    if (rawType === "all") {
      for (const type of validMetricTypes) {
        requested.add(type);
      }
      continue;
    }

    if (typeof rawType !== "string") {
      invalidTypes.add(String(rawType));
      continue;
    }

    if (validMetricTypes.has(rawType)) {
      requested.add(rawType);
    } else {
      invalidTypes.add(rawType);
    }
  }

  return {
    validTypes: Array.from(requested),
    invalidTypes: Array.from(invalidTypes),
    empty: requested.size === 0 && invalidTypes.size === 0,
  };
}

function createAckEvent(action, metrics, subscribedTo) {
  return {
    event: "ack",
    action,
    metrics,
    subscribedTo,
  };
}

wss.on("connection", (socket, request) => {
  const requestUrl = request?.url || "";
  const normalizedPath = normalizeWsPath(requestUrl.split("?")[0]);
  const subscribedTo = websocketSubscriptions.get(normalizedPath) ?? [];

  socket.subscribedTo = [...new Set(subscribedTo)];
  clients.add(socket);

  const welcomeMessage = {
    event: "connected",
    subscribedTo: socket.subscribedTo,
    validTypes: validWsTypes,
  };

  try {
    socket.send(JSON.stringify(welcomeMessage));
  } catch (error) {
    // ignore send errors on initial handshake
  }

  if (socket.subscribedTo.length > 0) {
    const snapshot = buildSnapshotForSubscription(socket.subscribedTo);
    try {
      socket.send(JSON.stringify(snapshot));
    } catch (error) {
      // ignore send errors for initial snapshot
    }
  }

  socket.on("message", (rawMessage) => {
    let message;

    try {
      message = JSON.parse(rawMessage.toString());
    } catch (error) {
      sendError(socket, "Invalid JSON: message must be valid JSON");
      return;
    }

    const { action, metrics } = message || {};
    if (action !== "subscribe" && action !== "unsubscribe") {
      sendError(socket, `Unknown action: ${action === undefined ? "missing" : `'${action}'`}`);
      return;
    }

    const metricsInfo = normalizeMetrics(metrics);
    if (metricsInfo.empty) {
      sendError(socket, "Metric list is required and must contain at least one metric type");
      return;
    }

    if (metricsInfo.invalidTypes.length > 0) {
      const invalidText = metricsInfo.invalidTypes.map((type) => `'${type}'`).join(", ");
      sendError(socket, `Unknown metric type${metricsInfo.invalidTypes.length > 1 ? "s" : ""}: ${invalidText}`);
      return;
    }

    const currentSet = new Set(socket.subscribedTo);
    const added = [];
    const removed = [];

    if (action === "subscribe") {
      for (const type of metricsInfo.validTypes) {
        if (!currentSet.has(type)) {
          currentSet.add(type);
          added.push(type);
        }
      }
      socket.subscribedTo = Array.from(currentSet);
      const ackMessage = createAckEvent(action, added, socket.subscribedTo);
      try {
        socket.send(JSON.stringify(ackMessage));
      } catch (error) {
        // ignore send errors for ack
      }

      if (added.length > 0) {
        const snapshot = buildSnapshotForSubscription(added);
        try {
          socket.send(JSON.stringify(snapshot));
        } catch (error) {
          // ignore send errors for snapshot
        }
      }
    }

    if (action === "unsubscribe") {
      for (const type of metricsInfo.validTypes) {
        if (currentSet.delete(type)) {
          removed.push(type);
        }
      }
      socket.subscribedTo = Array.from(currentSet);
      const ackMessage = createAckEvent(action, removed, socket.subscribedTo);
      try {
        socket.send(JSON.stringify(ackMessage));
      } catch (error) {
        // ignore send errors for ack
      }
    }
  });

  socket.on("close", () => {
    clients.delete(socket);
  });

  socket.on("error", () => {
    clients.delete(socket);
  });
});

const sendBroadcastSnapshot = (snapshot) => {
  for (const socket of Array.from(clients)) {
    if (!socket.subscribedTo || socket.subscribedTo.length === 0) {
      continue;
    }

    if (socket.readyState !== WebSocket.OPEN) {
      clients.delete(socket);
      continue;
    }

    const payload = { timestamp: snapshot.timestamp };
    for (const type of socket.subscribedTo) {
      if (snapshot[type] !== undefined) {
        payload[type] = snapshot[type];
      }
    }

    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      clients.delete(socket);
    }
  }
};

server.on("upgrade", (request, socket, head) => {
  const url = request.url || "";
  if (url.startsWith("/ws")) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
    return;
  }

  socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
  socket.destroy();
});

initMetrics(1000, sendBroadcastSnapshot);

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
