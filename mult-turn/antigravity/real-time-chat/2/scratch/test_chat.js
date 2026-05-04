import WebSocket from 'ws';

const PORT = 5000;
const TOKEN_A = process.argv[2];
const TOKEN_B = process.argv[3];

const connect = (token, name) => {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}?token=${token}`);
    ws.on('open', () => {
      console.log(`${name} connected`);
      resolve(ws);
    });
    ws.on('message', (data) => {
      console.log(`${name} received:`, data.toString());
    });
  });
};

async function runTests() {
  const wsA = await connect(TOKEN_A, 'User A');
  
  console.log('User A sending message...');
  wsA.send(JSON.stringify({ type: 'message', content: 'Hello from A' }));
  
  await new Promise(r => setTimeout(r, 1000));

  const wsB = await connect(TOKEN_B, 'User B');
  
  await new Promise(r => setTimeout(r, 1000));

  console.log('User B sending message...');
  wsB.send(JSON.stringify({ type: 'message', content: 'Hello from B' }));

  await new Promise(r => setTimeout(r, 1000));

  wsA.close();
  wsB.close();
}

runTests();
