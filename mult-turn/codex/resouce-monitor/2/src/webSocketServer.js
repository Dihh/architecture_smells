import { WebSocket, WebSocketServer } from 'ws';
import {
  getLatestSnapshot,
  onSnapshotCollected,
  VALID_METRIC_TYPES,
} from './metricsCollector.js';

const VALID_WS_TYPES = ['all', 'cpu', 'memory', 'disk', 'uptime'];

const connectedClients = new Set();

export function attachWebSocketServer(server) {
  const webSocketServer = new WebSocketServer({
    noServer: true,
  });

  server.on('upgrade', (request, socket, head) => {
    if (!isWebSocketPath(request.url)) {
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (socketConnection) => {
      webSocketServer.emit('connection', socketConnection, request);
    });
  });

  webSocketServer.on('connection', (socket, request) => {
    const client = {
      socket,
      subscribedTo: new Set(getAutoSubscription(request.url)),
    };
    connectedClients.add(client);

    sendJson(socket, {
      event: 'connected',
      subscribedTo: getSubscribedTypes(client),
      validTypes: VALID_WS_TYPES,
    });

    if (client.subscribedTo.size > 0) {
      sendJson(socket, getSubscribedSnapshot(getSubscribedTypes(client)));
    }

    socket.on('message', (message) => {
      handleClientMessage(client, message);
    });

    socket.on('close', () => {
      removeClient(socket);
    });

    socket.on('error', () => {
      removeClient(socket);
    });
  });

  onSnapshotCollected((snapshot) => {
    broadcastSnapshot(snapshot);
  });

  return {
    connectedClients,
    webSocketServer,
  };
}

function broadcastSnapshot(snapshot) {
  for (const client of connectedClients) {
    if (client.subscribedTo.size === 0) {
      continue;
    }

    if (client.socket.readyState !== WebSocket.OPEN) {
      connectedClients.delete(client);
      continue;
    }

    try {
      sendJson(client.socket, getSubscribedSnapshot(
        getSubscribedTypes(client),
        snapshot,
      ));
    } catch {
      connectedClients.delete(client);
    }
  }
}

function handleClientMessage(client, message) {
  const request = parseClientMessage(message);

  if (request?.parseError) {
    sendError(client.socket, 'Message was not valid JSON.');
    return;
  }

  if (!request || request.action !== 'subscribe' && request.action !== 'unsubscribe') {
    sendError(client.socket, getUnknownActionMessage(request));
    return;
  }

  const metricsValidation = validateMetrics(request.metrics);

  if (!metricsValidation.valid) {
    sendError(client.socket, metricsValidation.message);
    return;
  }

  if (request.action === 'subscribe') {
    handleSubscribe(client, metricsValidation.metrics);
    return;
  }

  handleUnsubscribe(client, metricsValidation.metrics);
}

function handleSubscribe(client, metrics) {
  const addedMetrics = metrics.filter((metric) => !client.subscribedTo.has(metric));

  for (const metric of addedMetrics) {
    client.subscribedTo.add(metric);
  }

  sendJson(client.socket, {
    event: 'ack',
    action: 'subscribe',
    metrics: addedMetrics,
    subscribedTo: getSubscribedTypes(client),
  });

  if (addedMetrics.length > 0) {
    sendJson(client.socket, getSubscribedSnapshot(addedMetrics));
  }
}

function handleUnsubscribe(client, metrics) {
  const removedMetrics = metrics.filter((metric) => client.subscribedTo.has(metric));

  for (const metric of removedMetrics) {
    client.subscribedTo.delete(metric);
  }

  sendJson(client.socket, {
    event: 'ack',
    action: 'unsubscribe',
    metrics: removedMetrics,
    subscribedTo: getSubscribedTypes(client),
  });
}

function parseClientMessage(message) {
  try {
    return JSON.parse(message.toString());
  } catch {
    return { parseError: true };
  }
}

function getUnknownActionMessage(request) {
  if (request && Object.hasOwn(request, 'action')) {
    return `Unknown or unsupported action: ${request.action}`;
  }

  return 'Unknown or unsupported action.';
}

function validateMetrics(metrics) {
  if (!Array.isArray(metrics) || metrics.length === 0) {
    return {
      valid: false,
      message: 'At least one metric type is required.',
    };
  }

  const unknownMetrics = metrics.filter((metric) => !VALID_WS_TYPES.includes(metric));

  if (unknownMetrics.length > 0) {
    return {
      valid: false,
      message: `Unknown metric type: '${unknownMetrics.join("', '")}'`,
    };
  }

  const expandedMetrics = metrics.flatMap((metric) => (
    metric === 'all' ? VALID_METRIC_TYPES : metric
  ));

  return {
    valid: true,
    metrics: VALID_METRIC_TYPES.filter((metric) => expandedMetrics.includes(metric)),
  };
}

function getSubscribedTypes(client) {
  return VALID_METRIC_TYPES.filter((metric) => client.subscribedTo.has(metric));
}

function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // The close event will remove the client; this keeps mid-send disconnects quiet.
  }
}

function sendError(socket, message) {
  sendJson(socket, {
    event: 'error',
    message,
  });
}

function removeClient(socket) {
  for (const client of connectedClients) {
    if (client.socket === socket) {
      connectedClients.delete(client);
      return;
    }
  }
}

function isWebSocketPath(url) {
  const { pathname } = new URL(url, 'http://localhost');

  return pathname === '/ws' || pathname.startsWith('/ws/');
}

function getAutoSubscription(url) {
  const { pathname } = new URL(url, 'http://localhost');
  const pathType = pathname.split('/')[2];

  if (!pathType) {
    return [];
  }

  if (pathType === 'all') {
    return VALID_METRIC_TYPES;
  }

  if (VALID_METRIC_TYPES.includes(pathType)) {
    return [pathType];
  }

  return [];
}

function getSubscribedSnapshot(subscribedTo, snapshot = getLatestSnapshot()) {
  return subscribedTo.reduce(
    (payload, type) => ({
      ...payload,
      [type]: snapshot[type],
    }),
    { timestamp: snapshot.timestamp },
  );
}
