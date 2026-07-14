#!/usr/bin/env node
/**
 * Fix malformed workflow connections
 * The n8n-mcp tool creates connections with "type": "0" instead of "type": "main"
 */

const env = require('./lib/env');

const apiKey = env.require('N8N_API_KEY');
const { client, hostname, port } = env.n8nTarget();
const workflowId = process.argv[2];
if (!workflowId) {
  console.error('Usage: node fix-workflow-connections.js <workflow-id>');
  process.exit(1);
}

console.log('Fixing workflow:', workflowId);

// Get the workflow
const getOptions = {
  hostname,
  port,
  path: '/api/v1/workflows/' + workflowId,
  method: 'GET',
  headers: { 'X-N8N-API-KEY': apiKey }
};

client.request(getOptions, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error('Failed to get workflow:', res.statusCode, data);
      process.exit(1);
    }

    const workflow = JSON.parse(data);
    const connections = workflow.connections;
    let fixedCount = 0;

    // Fix all malformed connections
    for (const [nodeName, nodeConnections] of Object.entries(connections)) {
      // Check for numeric keys that should be 'main'
      for (const key of Object.keys(nodeConnections)) {
        if (key === '0' || key === '1' || key === '2') {
          const outputs = nodeConnections[key];

          // Fix target type from "0" to "main"
          for (const outputArray of outputs) {
            for (const connection of outputArray) {
              if (connection.type === '0' || connection.type === '1') {
                console.log(`  Fixing ${nodeName} -> ${connection.node}: type "${connection.type}" -> "main"`);
                connection.type = 'main';
                fixedCount++;
              }
            }
          }

          // Move from numeric key to main array
          if (key === '0') {
            if (!nodeConnections.main) {
              nodeConnections.main = [];
            }
            // Insert at position 0
            nodeConnections.main[0] = outputs[0];
            delete nodeConnections[key];
            console.log(`  Fixed ${nodeName}: moved key "0" to main[0]`);
          }
        }
      }
    }

    if (fixedCount === 0) {
      console.log('No malformed connections found!');
      process.exit(0);
    }

    console.log(`Fixed ${fixedCount} connection(s). Updating workflow...`);

    // Update the workflow
    const updatePayload = JSON.stringify({
      name: workflow.name,
      nodes: workflow.nodes,
      connections: connections,
      settings: workflow.settings
    });

    const updateOptions = {
      hostname,
      port,
      path: '/api/v1/workflows/' + workflowId,
      method: 'PUT',
      headers: {
        'X-N8N-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(updatePayload)
      }
    };

    const updateReq = client.request(updateOptions, (updateRes) => {
      let updateData = '';
      updateRes.on('data', chunk => updateData += chunk);
      updateRes.on('end', () => {
        if (updateRes.statusCode === 200) {
          console.log('Workflow connections fixed successfully!');
        } else {
          console.error('Failed to update workflow:', updateRes.statusCode);
          console.error(updateData.slice(0, 1000));
          process.exit(1);
        }
      });
    });

    updateReq.on('error', e => {
      console.error('Update error:', e.message);
      process.exit(1);
    });
    updateReq.write(updatePayload);
    updateReq.end();
  });
}).on('error', e => {
  console.error('Get error:', e.message);
  process.exit(1);
}).end();
