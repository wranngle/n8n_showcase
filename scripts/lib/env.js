// Loads ~/.claude/.env into process.env. Existing process.env values win.
// Require this module once at the top of any script that needs API keys.

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENV_PATH = path.join(os.homedir(), '.claude', '.env');

function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

if (fs.existsSync(ENV_PATH)) {
  const parsed = parseEnvFile(fs.readFileSync(ENV_PATH, 'utf8'));
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function requireEnv(key) {
  const v = process.env[key];
  if (!v) {
    throw new Error(`${key} is not set. Add it to ${ENV_PATH} or export it before running.`);
  }
  return v;
}

// Parses N8N_URL (e.g. https://n8n.example.com or http://localhost:5678) into
// request options plus the matching http/https client module.
function n8nTarget() {
  const url = new URL(requireEnv('N8N_URL'));
  const client = url.protocol === 'http:' ? require('http') : require('https');
  const port = Number(url.port || (url.protocol === 'http:' ? 80 : 443));
  return { client, hostname: url.hostname, port, origin: url.origin };
}

module.exports = { ENV_PATH, require: requireEnv, requireEnv, n8nTarget };
