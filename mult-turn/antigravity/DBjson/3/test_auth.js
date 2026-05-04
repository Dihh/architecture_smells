const axios = require('axios');

async function test() {
    const baseURL = 'http://localhost:3001';
    
    console.log('--- Testing /auth/register (Admin) ---');
    const adminRes = await axios.post(`${baseURL}/auth/register`, { username: 'admin', password: 'password123' });
    console.log('Admin Register Response:', adminRes.data);

    console.log('\n--- Testing /auth/register (User) ---');
    const userRes = await axios.post(`${baseURL}/auth/register`, { username: 'user1', password: 'password123' });
    console.log('User Register Response:', userRes.data);

    console.log('\n--- Testing /auth/register (Conflict) ---');
    try {
        await axios.post(`${baseURL}/auth/register`, { username: 'admin', password: 'password123' });
    } catch (err) {
        console.log('Conflict Register Response (Expected 409):', err.response.status);
    }

    console.log('\n--- Testing /auth/login (Admin) ---');
    const loginRes = await axios.post(`${baseURL}/auth/login`, { username: 'admin', password: 'password123' });
    console.log('Admin Login Response:', loginRes.data);

    console.log('\n--- Testing /auth/login (Wrong Password) ---');
    try {
        await axios.post(`${baseURL}/auth/login`, { username: 'admin', password: 'wrong' });
    } catch (err) {
        console.log('Login Wrong Password Response (Expected 401):', err.response.status);
    }
}

test().catch(err => {
    console.error('Test failed:', err.response ? err.response.data : err.message);
    process.exit(1);
});
