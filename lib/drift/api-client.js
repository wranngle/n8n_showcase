// HTTP helpers for the n8n public API (/api/v1, X-N8N-API-KEY auth).
//
// Note: the /rest/* endpoints used by earlier revisions of this file do NOT
// accept API-key auth (session cookie only). Everything here uses /api/v1,
// which does.

const http = require('http');
const https = require('https');
const { URL } = require('url');

function getJson({ n8nUrl, apiKey, path }) {
  const url = new URL(path, n8nUrl);
  const lib = url.protocol === 'https:' ? https : http;
  const opts = {
    method: 'GET',
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + (url.search || ''),
    headers: {
      'Accept': 'application/json',
      'X-N8N-API-KEY': apiKey,
    },
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GET ${path} failed: HTTP ${res.statusCode} ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`GET ${path} returned non-JSON: ${err.message}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Full fleet listing, following cursor pagination.
async function listDeployedWorkflows({ n8nUrl, apiKey }) {
  const items = [];
  let cursor = null;
  do {
    const path = `/api/v1/workflows?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const payload = await getJson({ n8nUrl, apiKey, path });
    if (!Array.isArray(payload.data)) {
      throw new Error('Unexpected /api/v1/workflows shape: missing data array');
    }
    items.push(...payload.data);
    cursor = payload.nextCursor || null;
  } while (cursor);
  return items;
}

function getWorkflow({ n8nUrl, apiKey, id }) {
  return getJson({ n8nUrl, apiKey, path: `/api/v1/workflows/${id}` });
}

module.exports = { getJson, listDeployedWorkflows, getWorkflow };
