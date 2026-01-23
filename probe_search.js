const axios = require('axios');

const ports = [3000];
const paths = ['/', '/search', '/api/search', '/query', '/v1/search'];
const params = ['q', 'query', 'text', 's'];

async function probe() {
    for (const path of paths) {
        for (const param of params) {
            const url = `http://localhost:3000${path}?${param}=test`;
            try {
                process.stdout.write(`Probing ${url}... `);
                const res = await axios.get(url, { timeout: 2000 });
                console.log(`STATUS: ${res.status}`);
                console.log('DATA:', typeof res.data === 'object' ? JSON.stringify(res.data).substring(0, 100) : res.data.substring(0, 100));
                return; // Found it?
            } catch (e) {
                console.log(`ERR: ${e.response ? e.response.status : e.message}`);
            }
        }
    }
}

probe();
