const axios = require('axios');

async function test() {
    const baseURL = 'http://localhost:3001';
    
    console.log('--- Setting up admin ---');
    await axios.post(`${baseURL}/auth/register`, { username: 'admin', password: 'password' });
    const adminToken = (await axios.post(`${baseURL}/auth/login`, { username: 'admin', password: 'password' })).data.token;

    console.log('\n--- Testing POST Metadata Protection ---');
    const postRes = await axios.post(`${baseURL}/products`, { 
        name: 'Safe P', 
        ownerId: 'hacker-id', 
        createdAt: '2000-01-01' 
    }, {
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    
    const item = postRes.data;
    console.log('Item created with:');
    console.log(' - id:', item.id);
    console.log(' - ownerId:', item.ownerId);
    console.log(' - createdAt:', item.createdAt);
    
    if (item.ownerId === 'hacker-id') console.error('FAILED: ownerId was spoofed!');
    if (item.createdAt === '2000-01-01') console.error('FAILED: createdAt was spoofed!');

    const originalCreatedAt = item.createdAt;

    console.log('\n--- Testing PUT Metadata Protection ---');
    await new Promise(r => setTimeout(r, 1000)); // Wait 1s to ensure updatedAt is different
    const putRes = await axios.put(`${baseURL}/products/${item.id}`, {
        name: 'Updated P',
        ownerId: 'new-owner',
        createdAt: '2022-01-01'
    }, {
        headers: { Authorization: `Bearer ${adminToken}` }
    });

    const updated = putRes.data;
    console.log('Item updated with:');
    console.log(' - ownerId:', updated.ownerId);
    console.log(' - createdAt:', updated.createdAt);
    console.log(' - updatedAt:', updated.updatedAt);

    if (updated.ownerId !== item.ownerId) console.error('FAILED: ownerId was changed!');
    if (updated.createdAt !== originalCreatedAt) console.error('FAILED: createdAt was changed!');
    if (updated.updatedAt === updated.createdAt) console.error('FAILED: updatedAt is same as createdAt!');
}

test().catch(err => {
    console.error('Test failed:', err.response ? err.response.data : err.message);
    process.exit(1);
});
