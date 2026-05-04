
import WebSocket from 'ws';

async function testMessages() {
  const baseUrl = 'http://localhost:5000';
  const wsUrl = 'ws://localhost:5000';
  const username = 'msguser_' + Math.random().toString(36).substring(7);
  const password = 'password123';

  console.log('--- Registering user ---');
  const regRes = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const { token } = await regRes.json();

  console.log('\n--- Connecting WS ---');
  const ws = new WebSocket(`${wsUrl}?token=${token}`);

  ws.on('open', () => {
    console.log('Connected');
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    console.log('Received:', msg.type);

    if (msg.type === 'history') {
      console.log('History length:', msg.messages.length);
      
      // Send a test message
      console.log('\n--- Sending Message ---');
      ws.send(JSON.stringify({ type: 'message', content: 'Hello World!' }));
    }

    if (msg.type === 'message') {
      console.log('Broadcast received:', msg.content, 'from', msg.username);
      
      // Test invalid JSON
      console.log('\n--- Sending Invalid JSON ---');
      ws.send('not a json');
    }

    if (msg.type === 'error') {
      console.log('Error received:', msg.message);
      
      if (msg.message === 'Invalid JSON received') {
        // Test empty content
        console.log('\n--- Sending Empty Content ---');
        ws.send(JSON.stringify({ type: 'message', content: '' }));
      } else {
        console.log('All tests finished. Closing...');
        ws.close();
      }
    }
  });

  ws.on('close', () => {
    console.log('WS Closed');
  });
}

testMessages();
