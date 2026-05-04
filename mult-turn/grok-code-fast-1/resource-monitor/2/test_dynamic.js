import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3001/ws');

ws.on('open', () => {
  console.log('Connected to /ws');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('Received:', msg);
  if (msg.event === 'connected') {
    // Send subscribe cpu
    setTimeout(() => {
      ws.send(JSON.stringify({ action: 'subscribe', metrics: ['cpu'] }));
    }, 100);
  } else if (msg.event === 'ack' && msg.action === 'subscribe' && msg.metrics.includes('cpu')) {
    // Send subscribe all
    setTimeout(() => {
      ws.send(JSON.stringify({ action: 'subscribe', metrics: ['all'] }));
    }, 100);
  } else if (msg.event === 'ack' && msg.action === 'subscribe' && msg.metrics.length === 3) {
    // Send unsubscribe cpu
    setTimeout(() => {
      ws.send(JSON.stringify({ action: 'unsubscribe', metrics: ['cpu'] }));
    }, 100);
  }
});

ws.on('close', () => {
  console.log('Disconnected');
});

// Run for 5 seconds
setTimeout(() => {
  ws.close();
}, 5000);