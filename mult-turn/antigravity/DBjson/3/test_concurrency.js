const axios = require('axios');

async function test() {
    const baseURL = 'http://localhost:3099';
    
    console.log('--- Setting up user ---');
    await axios.post(`${baseURL}/auth/register`, { username: 'c1', password: 'password' });
    const token = (await axios.post(`${baseURL}/auth/login`, { username: 'c1', password: 'password' })).data.token;
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    console.log('\n--- Testing 20 Simultaneous POSTs ---');
    const posts = [];
    for (let i = 0; i < 20; i++) {
        posts.push(axios.post(`${baseURL}/load`, { val: i }, auth));
    }
    const results = await Promise.all(posts);
    console.log('Successfully created 20 items');

    const all = await axios.get(`${baseURL}/load`, auth);
    console.log('Final count (should be 20):', all.data.length);

    console.log('\n--- Testing 15 Simultaneous PATCHes to same item ---');
    const itemId = all.data[0].id;
    const patches = [];
    for (let i = 0; i < 15; i++) {
        patches.push(axios.patch(`${baseURL}/load/${itemId}`, { val: i * 100 }, auth));
    }
    await Promise.all(patches);
    console.log('Successfully patched same item 15 times');

    const finalItem = await axios.get(`${baseURL}/load/${itemId}`, auth);
    console.log('Final item value:', finalItem.data.val);
}

test().catch(err => {
    console.error('Test failed:', err.response ? err.response.data : err.message);
    process.exit(1);
});
