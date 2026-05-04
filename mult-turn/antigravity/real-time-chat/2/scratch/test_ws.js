import WebSocket from 'ws';

const PORT = 5000;
const VALID_TOKEN = process.argv[2];

const testWS = (url, expectedCode) => {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.on('open', () => {
      console.log(`Connected to ${url}`);
      ws.close();
      resolve();
    });
    ws.on('close', (code) => {
      console.log(`Closed ${url} with code ${code}`);
      if (expectedCode && code !== expectedCode) {
        console.error(`Expected code ${expectedCode} but got ${code}`);
      }
      resolve();
    });
    ws.on('error', (err) => {
      console.log(`Error for ${url}: ${err.message}`);
      resolve();
    });
  });
};

async function runTests() {
  console.log('Testing no token...');
  await testWS(`ws://localhost:${PORT}`, 4001);

  console.log('Testing invalid token...');
  await testWS(`ws://localhost:${PORT}?token=invalid`, 4002);

  if (VALID_TOKEN) {
    console.log('Testing valid token...');
    await testWS(`ws://localhost:${PORT}?token=${VALID_TOKEN}`);
  }
}

runTests();
