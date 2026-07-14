#!/usr/bin/env node
const env = require('./lib/env');

const workflowId = process.argv[2];
if (!workflowId) {
  console.error('Usage: node activate-workflow.js <workflow-id>');
  process.exit(1);
}

const apiKey = env.require('N8N_API_KEY');
const { client, hostname, port } = env.n8nTarget();

const req = client.request({
  hostname,
  port,
  path: `/api/v1/workflows/${workflowId}/activate`,
  method: 'POST',
  headers: { 'X-N8N-API-KEY': apiKey }
}, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    if (res.statusCode === 200) {
      console.log('Workflow activated successfully');
    } else {
      console.log('Response:', data);
    }
  });
});
req.on('error', e => console.error('Error:', e.message));
req.end();
