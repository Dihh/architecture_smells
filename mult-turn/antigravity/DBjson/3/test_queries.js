const axios = require('axios');

async function test() {
    const baseURL = 'http://localhost:3088';
    
    console.log('--- Setting up data ---');
    await axios.post(`${baseURL}/auth/register`, { username: 'q1', password: 'password' });
    const token = (await axios.post(`${baseURL}/auth/login`, { username: 'q1', password: 'password' })).data.token;
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    const items = [
        { name: 'Apple', price: 10, active: true },
        { name: 'Banana', price: 20, active: false },
        { name: 'Cherry', price: 30, active: true },
        { name: 'Date', price: 40, active: false },
        { name: 'Elderberry', price: 50, active: true }
    ];

    for (const item of items) {
        await axios.post(`${baseURL}/products`, item, auth);
    }

    console.log('\n--- Testing Filters ---');
    const f1 = await axios.get(`${baseURL}/products?price__gt=25`, auth);
    console.log('price > 25 count (should be 3):', f1.data.length);

    const f2 = await axios.get(`${baseURL}/products?name__contains=er`, auth);
    console.log('name contains "er" (should be 2):', f2.data.length);

    const f3 = await axios.get(`${baseURL}/products?active=false`, auth);
    console.log('active=false (should be 2):', f3.data.length);

    const f4 = await axios.get(`${baseURL}/products?price__between=15,35`, auth);
    console.log('price between 15,35 (should be 2):', f4.data.length);

    const f5 = await axios.get(`${baseURL}/products?name__in=Apple,Date`, auth);
    console.log('name in [Apple,Date] (should be 2):', f5.data.length);

    console.log('\n--- Testing OR logic ---');
    const f6 = await axios.get(`${baseURL}/products?name=Apple&price=50&_or=true`, auth);
    console.log('name=Apple OR price=50 (should be 2):', f6.data.length);

    console.log('\n--- Testing Sorting ---');
    const s1 = await axios.get(`${baseURL}/products?_sort=price&_order=desc`, auth);
    console.log('Top price:', s1.data[0].price);

    console.log('\n--- Testing Pagination ---');
    const p1 = await axios.get(`${baseURL}/products?_limit=2&_offset=1`, auth);
    console.log('Paginated result keys:', Object.keys(p1.data));
    console.log('Paginated total:', p1.data.total);
    console.log('Paginated data length:', p1.data.data.length);
}

test().catch(err => {
    console.error('Test failed:', err.response ? err.response.data : err.message);
    process.exit(1);
});
