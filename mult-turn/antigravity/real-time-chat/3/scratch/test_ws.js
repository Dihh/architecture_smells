
import WebSocket from 'ws';

async function testWS() {
  const baseUrl = 'http://localhost:5000';
  const wsUrl = 'ws://localhost:5000';
  const username = 'wsuser_' + Math.random().toString(36).substring(7);
  const password = 'password123';

  console.log('--- Registering user ---');
  const regRes = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const { token } = await regRes.json();
  console.log('Token received');

  console.log('\n--- Testing WS: No Token ---');
  const ws1 = new WebSocket(`${wsUrl}`);
  ws1.on('close', (code, reason) => {
    console.log('WS1 Closed (Expected 4001):', code, reason.toString());
  });

  console.log('\n--- Testing WS: Invalid Token ---');
  const ws2 = new WebSocket(`${wsUrl}?token=invalid-token`);
  ws2.on('close', (code, reason) => {
    console.log('WS2 Closed (Expected 4002):', code, reason.toString());
  });

  console.log('\n--- Testing WS: Valid Token ---');
  const ws3 = new WebSocket(`${wsUrl}?token=${token}`);
  ws3.on('open', () => {
    console.log('WS3 Connected successfully');
    setTimeout(() => ws3.close(), 1000);
  });
  ws3.on('close', (code, reason) => {
    console.log('WS3 Closed:', code);
  });
  ws3.on('error', (err) => {
    console.error('WS3 Error:', err);
  });
}

testWS();
