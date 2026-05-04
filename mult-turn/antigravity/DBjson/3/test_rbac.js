const axios = require('axios');

async function test() {
    const baseURL = 'http://localhost:3001';
    
    console.log('--- Setting up users ---');
    const adminReg = await axios.post(`${baseURL}/auth/register`, { username: 'admin', password: 'password' });
    const adminToken = (await axios.post(`${baseURL}/auth/login`, { username: 'admin', password: 'password' })).data.token;
    
    const user1Reg = await axios.post(`${baseURL}/auth/register`, { username: 'user1', password: 'password' });
    const user1Token = (await axios.post(`${baseURL}/auth/login`, { username: 'user1', password: 'password' })).data.token;

    const user2Reg = await axios.post(`${baseURL}/auth/register`, { username: 'user2', password: 'password' });
    const user2Token = (await axios.post(`${baseURL}/auth/login`, { username: 'user2', password: 'password' })).data.token;

    console.log('\n--- Testing Reserved Collections ---');
    try {
        await axios.get(`${baseURL}/_users`, { headers: { Authorization: `Bearer ${adminToken}` } });
    } catch (err) {
        console.log('GET /_users Response (Expected 403):', err.response.status);
    }

    console.log('\n--- Testing /auth/users (Admin vs User) ---');
    const usersRes = await axios.get(`${baseURL}/auth/users`, { headers: { Authorization: `Bearer ${adminToken}` } });
    console.log('Admin GET /auth/users count:', usersRes.data.length);
    try {
        await axios.get(`${baseURL}/auth/users`, { headers: { Authorization: `Bearer ${user1Token}` } });
    } catch (err) {
        console.log('User GET /auth/users Response (Expected 403):', err.response.status);
    }

    console.log('\n--- Testing PATCH /auth/users/:id/role ---');
    const user1Id = user1Reg.data.id;
    const patchRes = await axios.patch(`${baseURL}/auth/users/${user1Id}/role`, { role: 'admin' }, {
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('New role for user1:', patchRes.data.role);

    console.log('\n--- Testing Ownership ---');
    const p1 = await axios.post(`${baseURL}/products`, { name: 'P1' }, { headers: { Authorization: `Bearer ${user2Token}` } });
    const p1Id = p1.data.id;
    console.log('User2 created product:', p1Id);

    const user2Products = await axios.get(`${baseURL}/products`, { headers: { Authorization: `Bearer ${user2Token}` } });
    console.log('User2 sees products count:', user2Products.data.length);

    const user1Products = await axios.get(`${baseURL}/products`, { headers: { Authorization: `Bearer ${user1Token}` } });
    console.log('User1 (now admin) sees products count:', user1Products.data.length);
}

test().catch(err => {
    console.error('Test failed:', err.response ? err.response.data : err.message);
    process.exit(1);
});
