const env = require('./lib/env');

const apiKey = env.require('N8N_API_KEY');
const { client, hostname, port } = env.n8nTarget();

const twilioCredential = {
    name: "Twilio API Credentials",
    type: "twilioApi",
    data: {
        authType: "authToken",
        accountSid: env.require('TWILIO_ACCOUNT_SID'),
        authToken: env.require('TWILIO_AUTH_TOKEN'),
        apiKeySid: "",
        apiKeySecret: ""
    }
};

const postData = JSON.stringify(twilioCredential);
console.log('Sending:', postData);

const options = {
    hostname,
    port,
    path: '/api/v1/credentials',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': apiKey,
        'Content-Length': Buffer.byteLength(postData)
    }
};

const req = client.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log(`Response: ${data}`);
        if (res.statusCode === 200 || res.statusCode === 201) {
            const result = JSON.parse(data);
            console.log(`\nSUCCESS! Twilio Credential ID: ${result.id}`);
        }
    });
});

req.on('error', (e) => {
    console.error(`Error: ${e.message}`);
});

req.write(postData);
req.end();
