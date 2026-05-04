const axios = require('axios');

async function test() {
    const baseURL = 'http://localhost:3001';
    
    console.log('--- Testing /auth/me (No Token) ---');
    try {
        await axios.get(`${baseURL}/auth/me`);
    } catch (err) {
        console.log('No Token Response (Expected 401):', err.response.status);
    }

    console.log('\n--- Testing /products (No Token) ---');
    try {
        await axios.get(`${baseURL}/products`);
    } catch (err) {
        console.log('No Token Response (Expected 401):', err.response.status);
    }

    console.log('\n--- Logging in ---');
    await axios.post(`${baseURL}/auth/register`, { username: 'testuser', password: 'password123' });
    const loginRes = await axios.post(`${baseURL}/auth/login`, { username: 'testuser', password: 'password123' });
    const token = loginRes.data.token;

    console.log('\n--- Testing /auth/me (With Token) ---');
    const meRes = await axios.get(`${baseURL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Me Response:', meRes.data);

    console.log('\n--- Testing /products (With Token) ---');
    const productsRes = await axios.get(`${baseURL}/products`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Products Response:', productsRes.data);
}

test().catch(err => {
    console.error('Test failed:', err.response ? err.response.data : err.message);
    process.exit(1);
});
