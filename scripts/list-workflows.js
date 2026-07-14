const env = require('./lib/env');

const { client, hostname, port } = env.n8nTarget();

const options = {
  hostname,
  port,
  path: '/api/v1/workflows',
  method: 'GET',
  headers: {
    'X-N8N-API-KEY': env.require('N8N_API_KEY'),
    'Content-Type': 'application/json'
  }
};

const req = client.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log(JSON.stringify(json, null, 2));
    } catch (e) {
      console.log(data);
    }
  });
});

req.on('error', (e) => console.error('Error:', e.message));
req.end();
