const axios = require('axios');

async function test() {
    const baseURL = 'http://localhost:3001';
    
    console.log('--- Setting up users ---');
    await axios.post(`${baseURL}/auth/register`, { username: 'admin', password: 'password' });
    const adminToken = (await axios.post(`${baseURL}/auth/login`, { username: 'admin', password: 'password' })).data.token;
    console.log('Admin Token acquired');
    
    const u1 = await axios.post(`${baseURL}/auth/register`, { username: 'user1', password: 'password' });
    const user1Id = u1.data.id;
    console.log('User1 registered');

    console.log('\n--- Testing /auth/users ---');
    try {
        const usersRes = await axios.get(`${baseURL}/auth/users`, { headers: { Authorization: `Bearer ${adminToken}` } });
        console.log('Admin GET /auth/users status:', usersRes.status);
        console.log('Admin GET /auth/users data:', usersRes.data);
    } catch (err) {
        console.log('Admin GET /auth/users Error:', err.response ? err.response.status : err.message);
        console.log('Error data:', err.response ? err.response.data : 'no data');
    }
}

test().catch(err => {
    console.error('Test failed:', err.message);
    process.exit(1);
});
