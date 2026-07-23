#!/usr/bin/env node
// Installer: POST a sanitized workflow JSON file to an n8n instance via the
// public API. Creates the workflow deactivated; activate it in the n8n UI
// after wiring credentials.
//
// Usage: node scripts/install-workflow.js <workflow.json> [--n8n-url <url>] [--api-key <key>]
//   Credentials default to N8N_URL / N8N_API_KEY (loaded from ~/.claude/.env).
//
// Note: POST /api/v1/workflows accepts only {name, nodes, connections,
// settings} — the payload is projected down to those keys, so a full exhibit
// file installs cleanly. (/rest/* endpoints do not accept API-key auth;
// earlier revisions of this script used them and could never have worked.)

const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
require('./lib/env');

const INSTALL_KEYS = ['name', 'nodes', 'connections', 'settings'];

function parseArgs(argv) {
  const out = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out.flags[key] = true;
      } else {
        out.flags[key] = next;
        i++;
      }
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

function usage() {
  console.error('Usage: node scripts/install-workflow.js <workflow.json> [--n8n-url <url>] [--api-key <key>]');
  console.error('  POSTs the workflow to <n8n-url>/api/v1/workflows and prints the new workflow id.');
}

function projectPayload(workflow) {
  const out = {};
  for (const key of INSTALL_KEYS) {
    if (workflow[key] !== undefined) out[key] = workflow[key];
  }
  if (!out.name || !Array.isArray(out.nodes) || out.nodes.length === 0) {
    throw new Error('workflow must have a non-empty name and a non-empty nodes array');
  }
  if (!out.connections) out.connections = {};
  if (!out.settings) out.settings = {};
  return out;
}

function postWorkflow({ n8nUrl, apiKey, workflow }) {
  const url = new URL('/api/v1/workflows', n8nUrl);
  const body = JSON.stringify(workflow);
  const lib = url.protocol === 'https:' ? https : http;
  const opts = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-N8N-API-KEY': apiKey,
    },
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function extractId(responseBody) {
  let parsed;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return null;
  }
  if (parsed && typeof parsed === 'object') {
    if (parsed.id !== undefined) return parsed.id;
    if (parsed.data && parsed.data.id !== undefined) return parsed.data.id;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workflowPath = args.positional[0];
  const n8nUrl = args.flags['n8n-url'] || process.env.N8N_URL;
  const apiKey = args.flags['api-key'] || process.env.N8N_API_KEY;

  if (!workflowPath || !n8nUrl || !apiKey) {
    usage();
    process.exit(2);
  }

  const workflow = projectPayload(JSON.parse(fs.readFileSync(workflowPath, 'utf8')));
  const { status, body } = await postWorkflow({ n8nUrl, apiKey, workflow });

  if (status >= 200 && status < 300) {
    const id = extractId(body);
    if (id !== null) {
      console.log(id);
      process.exit(0);
    }
    console.error('n8n responded OK but no id field found:', body);
    process.exit(1);
  }

  console.error(`POST /api/v1/workflows failed: HTTP ${status}`);
  console.error(body);
  process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('install-workflow:', err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, extractId, postWorkflow, projectPayload, INSTALL_KEYS };
