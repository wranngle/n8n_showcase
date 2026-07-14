// List n8n credentials
const env = require('./lib/env');

const apiKey = env.require('N8N_API_KEY');
const { client, hostname, port } = env.n8nTarget();

const options = {
  hostname,
  port,
  path: '/api/v1/credentials',
  method: 'GET',
  headers: {
    'X-N8N-API-KEY': apiKey
  }
};

const req = client.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Raw response:', data);
    try {
      const creds = JSON.parse(data);
      console.log('\nExisting credentials:');
      const list = creds.data || creds;
      if (Array.isArray(list)) {
        list.forEach(c => console.log(`  - ${c.id}: ${c.name} (${c.type})`));
      } else {
        console.log('Response structure:', JSON.stringify(creds, null, 2));
      }
    } catch (e) {
      console.log('Parse error:', e.message);
    }
  });
});

req.on('error', e => console.error(e));
req.end();
