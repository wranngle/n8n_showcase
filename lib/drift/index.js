// Exhibit drift: re-fetch every workflow named in workflows/exhibits.yaml
// from the live instance, re-sanitize it, and compare byte-for-byte against
// the checked-in file. The contract is simple: each exhibit file IS the
// sanitized live workflow; anything else is drift.
//
// Also emits a fleet summary (counts by phase/active) so the report shows
// how much of the instance the exhibits cover.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const { listDeployedWorkflows, getWorkflow } = require('./api-client');
const { sanitizeWorkflow, serialize } = require('../../scripts/sanitize-workflow');

function sha(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function loadManifest(manifestPath) {
  const { exhibits } = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(exhibits) || exhibits.length === 0) {
    throw new Error(`No exhibits found in ${manifestPath}`);
  }
  return exhibits;
}

function phaseOf(workflow) {
  const tagNames = (workflow.tags || [])
    .map((t) => (t && typeof t === 'object' ? t.name : t))
    .filter(Boolean)
    .map((t) => String(t).toUpperCase());
  for (const phase of ['ARCHIVED', 'PROD', 'GA', 'BETA', 'ALPHA', 'DEV', 'UTIL']) {
    if (tagNames.includes(phase)) return phase;
  }
  const m = /^\[([A-Z]+)\]/.exec(workflow.name || '');
  if (m) return m[1];
  return 'UNPHASED';
}

function fleetSummary(deployed) {
  const byPhase = {};
  let active = 0;
  for (const wf of deployed) {
    const phase = phaseOf(wf);
    byPhase[phase] = (byPhase[phase] || 0) + 1;
    if (wf.active) active += 1;
  }
  return { total: deployed.length, active, byPhase };
}

async function computeExhibitDrift({ n8nUrl, apiKey, repoRoot, manifestPath }) {
  const exhibits = loadManifest(manifestPath);
  const results = [];

  for (const exhibit of exhibits) {
    const filePath = path.join(repoRoot, exhibit.file);
    const entry = { id: exhibit.id, file: exhibit.file, title: exhibit.title };

    let live;
    try {
      live = await getWorkflow({ n8nUrl, apiKey, id: exhibit.id });
    } catch (err) {
      results.push({ ...entry, status: 'missing-on-instance', detail: err.message });
      continue;
    }
    const expected = serialize(sanitizeWorkflow(live).workflow);

    if (!fs.existsSync(filePath)) {
      results.push({ ...entry, status: 'missing-in-repo', liveName: live.name });
      continue;
    }
    const actual = fs.readFileSync(filePath, 'utf8');
    results.push({
      ...entry,
      liveName: live.name,
      status: expected === actual ? 'in-sync' : 'drifted',
      liveHash: sha(expected),
      repoHash: sha(actual),
    });
  }

  return results;
}

function renderReport({ results, fleet, n8nUrl, generatedAt }) {
  const drifted = results.filter((r) => r.status !== 'in-sync');
  const lines = [];
  lines.push('# Drift report — exhibits vs live instance');
  lines.push('');
  lines.push(`- Instance: ${n8nUrl}`);
  lines.push(`- Generated: ${generatedAt}`);
  lines.push(`- Exhibits checked: ${results.length}`);
  lines.push(`- In sync: ${results.length - drifted.length}`);
  lines.push(`- Drifted or missing: ${drifted.length}`);
  lines.push('');
  lines.push('## Fleet summary');
  lines.push('');
  lines.push(`${fleet.total} workflows on the instance, ${fleet.active} active. ` +
    `Exhibits cover ${results.length} of them; the rest are visible in workflows/registry.yaml.`);
  lines.push('');
  lines.push('| Phase | Count |');
  lines.push('|---|---|');
  for (const [phase, count] of Object.entries(fleet.byPhase).sort()) {
    lines.push(`| ${phase} | ${count} |`);
  }
  lines.push('');
  lines.push('## Per-exhibit status');
  lines.push('');
  lines.push('| Exhibit | Live name | Status |');
  lines.push('|---|---|---|');
  for (const r of results) {
    const detail = r.status === 'drifted' ? ` (live ${r.liveHash} vs repo ${r.repoHash})` : '';
    lines.push(`| ${r.file} | ${r.liveName || '—'} | ${r.status}${detail} |`);
  }
  lines.push('');
  if (drifted.length > 0) {
    lines.push('Refresh with: `node scripts/export-live-workflows.js`');
    lines.push('');
  }
  return lines.join('\n');
}

async function runDrift({ n8nUrl, apiKey, repoRoot, manifestPath, now = new Date() }) {
  const [results, deployed] = [
    await computeExhibitDrift({ n8nUrl, apiKey, repoRoot, manifestPath }),
    await listDeployedWorkflows({ n8nUrl, apiKey }),
  ];
  const fleet = fleetSummary(deployed);
  const report = renderReport({ results, fleet, n8nUrl, generatedAt: now.toISOString() });
  const driftedCount = results.filter((r) => r.status !== 'in-sync').length;
  return { results, fleet, report, driftedCount };
}

module.exports = { loadManifest, phaseOf, fleetSummary, computeExhibitDrift, renderReport, runDrift, sha };
