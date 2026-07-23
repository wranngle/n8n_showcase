#!/usr/bin/env node
/**
 * export-live-workflows.js — refresh the checked-in exhibits from the live
 * instance.
 *
 * Reads workflows/exhibits.yaml, fetches each workflow by id from
 * `$N8N_URL/api/v1/workflows/:id` (public API, X-N8N-API-KEY auth), runs it
 * through scripts/sanitize-workflow.js, and writes the sanitized JSON to the
 * manifest path. Prints one receipt line per exhibit.
 *
 * Usage: node scripts/export-live-workflows.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const env = require('./lib/env');
const { sanitizeWorkflow, serialize } = require('./sanitize-workflow');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'workflows', 'exhibits.yaml');

function fetchWorkflow(id) {
  const { client, hostname, port } = env.n8nTarget();
  const apiKey = env.require('N8N_API_KEY');
  return new Promise((resolve, reject) => {
    const req = client.request(
      { hostname, port, path: `/api/v1/workflows/${id}`, method: 'GET',
        headers: { 'X-N8N-API-KEY': apiKey, Accept: 'application/json' } },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`GET /api/v1/workflows/${id} -> HTTP ${res.statusCode}`));
            return;
          }
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { exhibits } = yaml.load(fs.readFileSync(MANIFEST, 'utf8'));
  let changed = 0;

  for (const exhibit of exhibits) {
    const raw = await fetchWorkflow(exhibit.id);
    const { workflow, report } = sanitizeWorkflow(raw);
    const output = serialize(workflow);
    const outPath = path.join(ROOT, exhibit.file);
    const previous = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
    const status = previous === output ? 'unchanged' : (previous === null ? 'new' : 'updated');
    if (status !== 'unchanged') changed += 1;

    const counts = {};
    for (const r of report.redactions) counts[r.label] = (counts[r.label] || 0) + 1;
    const redactionSummary = Object.entries(counts).map(([l, n]) => `${l}×${n}`).join(', ') || 'none';
    console.log(`${status.padEnd(9)} ${exhibit.file} (${raw.nodes.length} nodes, redactions: ${redactionSummary})`);

    if (!dryRun && status !== 'unchanged') {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, output);
    }
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}${exhibits.length} exhibits, ${changed} ${dryRun ? 'would change' : 'written'}`);
}

main().catch((e) => { console.error(`export failed: ${e.message}`); process.exit(1); });
