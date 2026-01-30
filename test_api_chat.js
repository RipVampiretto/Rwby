const axios = require('axios');
require('dotenv').config({ path: '.env.rwby' });

async function testChat() {
    const url = (process.env.LM_STUDIO_URL || 'http://localhost:1234').replace('ws://', 'http://').replace('wss://', 'https://') + '/v1/chat/completions';
    const model = process.env.LM_STUDIO_MODEL;

    console.log(`Testing Chat API at ${url} with model ${model}`);

    try {
        const response = await axios.post(url, {
            model: model,
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: "Say hello!" }
            ],
            temperature: 0.7
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log("Success! Response:");
        console.log(JSON.stringify(response.data, null, 2));
    } catch (e) {
        console.error("Error:");
        if (e.response) {
            console.error(e.response.status, e.response.data);
        } else {
            console.error(e.message);
        }
    }
}

testChat();
