import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3001/ws');

ws.on('open', () => {
  console.log('Connected to /ws');
  
  setTimeout(() => {
    console.log('Subscribing to cpu...');
    ws.send(JSON.stringify({ action: 'subscribe', metrics: ['cpu'] }));
  }, 1000);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('Received:', JSON.stringify(msg, null, 2));

  if (msg.event === 'ack' && msg.action === 'subscribe') {
    console.log('Ack received for subscribe');
    setTimeout(() => {
      console.log('Unsubscribing from cpu...');
      ws.send(JSON.stringify({ action: 'unsubscribe', metrics: ['cpu'] }));
    }, 2000);
  }

  if (msg.event === 'ack' && msg.action === 'unsubscribe') {
    console.log('Ack received for unsubscribe');
    ws.close();
  }
});

ws.on('close', () => {
  console.log('Disconnected');
});

ws.on('error', (err) => {
  console.error('Error:', err.message);
});
