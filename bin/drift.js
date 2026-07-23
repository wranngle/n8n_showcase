#!/usr/bin/env node
// Drift detector: re-fetches every exhibit in workflows/exhibits.yaml from
// the live instance, re-sanitizes, and compares byte-for-byte against the
// checked-in file. Exits non-zero on any divergence, so it can gate CI.
//
// Usage: node bin/drift.js [--n8n-url <url>] [--api-key <key>] [--out <file>]
//   Credentials default to N8N_URL / N8N_API_KEY (loaded from ~/.claude/.env).
//   --out defaults to docs/drift-report.md.

const fs = require('fs');
const path = require('path');
require('../scripts/lib/env');
const { runDrift } = require('../lib/drift');

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const n8nUrl = args.flags['n8n-url'] || process.env.N8N_URL;
  const apiKey = args.flags['api-key'] || process.env.N8N_API_KEY;
  const repoRoot = path.join(__dirname, '..');
  const manifestPath = path.join(repoRoot, 'workflows', 'exhibits.yaml');
  const outPath = path.resolve(args.flags['out'] || path.join(repoRoot, 'docs', 'drift-report.md'));

  if (!n8nUrl || !apiKey) {
    console.error('drift: N8N_URL and N8N_API_KEY are required (env or --n8n-url/--api-key).');
    process.exit(2);
  }

  const { results, report, driftedCount } = await runDrift({ n8nUrl, apiKey, repoRoot, manifestPath });
  fs.writeFileSync(outPath, report);
  console.log(`wrote ${outPath}`);
  console.log(`exhibits=${results.length} in-sync=${results.length - driftedCount} drifted=${driftedCount}`);
  process.exit(driftedCount === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('drift:', err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs };
