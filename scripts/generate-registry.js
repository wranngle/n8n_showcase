#!/usr/bin/env node
/**
 * generate-registry.js — regenerate workflows/registry.yaml and
 * workflows/governance.yaml mechanically from the live instance.
 *
 * The previous versions of both files were hand-maintained snapshots that
 * drifted for months and ended up contradicting each other. These files are
 * now build artifacts of the fleet: rerun this script to refresh them.
 *
 * Usage: node scripts/generate-registry.js
 */

const fs = require('fs');
const path = require('path');
const env = require('./lib/env');
const { listDeployedWorkflows } = require('../lib/drift/api-client');
const { phaseOf } = require('../lib/drift');

const ROOT = path.join(__dirname, '..');

function yamlEscape(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function detectKnownDrift(fleet) {
  const drift = { dual_active_versions: [], unphased_names: [], version_suffix_names: [] };
  const activeByBase = new Map();
  for (const wf of fleet) {
    if (!/^\[/.test(wf.name)) drift.unphased_names.push(wf.name);
    const versionMatch = /^(.*)\s*\/\s*v\d+(?:$|\s)/.exec(wf.name);
    if (versionMatch) {
      drift.version_suffix_names.push(wf.name);
      if (wf.active) {
        const base = versionMatch[1].trim();
        activeByBase.set(base, (activeByBase.get(base) || []).concat(wf.name));
      }
    }
  }
  for (const [base, names] of activeByBase) {
    if (names.length > 1) drift.dual_active_versions.push({ base, names });
  }
  drift.unphased_names.sort();
  drift.version_suffix_names.sort();
  return drift;
}

async function main() {
  const n8nUrl = env.requireEnv('N8N_URL');
  const apiKey = env.requireEnv('N8N_API_KEY');
  const generatedAt = new Date().toISOString();

  const fleet = (await listDeployedWorkflows({ n8nUrl, apiKey }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const host = new URL(n8nUrl).hostname;

  const phaseCounts = {};
  for (const wf of fleet) {
    const phase = phaseOf(wf);
    phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
  }
  const activeCount = fleet.filter((w) => w.active).length;

  // --- registry.yaml: the fleet inventory ---
  const reg = [];
  reg.push('# GENERATED FILE — do not edit by hand.');
  reg.push('# Regenerate with: node scripts/generate-registry.js');
  reg.push(`# Instance: ${host}`);
  reg.push(`generated_at: ${yamlEscape(generatedAt)}`);
  reg.push(`instance: ${yamlEscape(host)}`);
  reg.push(`total: ${fleet.length}`);
  reg.push(`active: ${activeCount}`);
  reg.push('workflows:');
  for (const wf of fleet) {
    reg.push(`  - id: ${yamlEscape(wf.id)}`);
    reg.push(`    name: ${yamlEscape(wf.name)}`);
    reg.push(`    phase: ${phaseOf(wf)}`);
    reg.push(`    active: ${Boolean(wf.active)}`);
    reg.push(`    archived: ${Boolean(wf.isArchived)}`);
    reg.push(`    nodes: ${Array.isArray(wf.nodes) ? wf.nodes.length : 0}`);
    reg.push(`    updated: ${yamlEscape(wf.updatedAt || '')}`);
  }
  fs.writeFileSync(path.join(ROOT, 'workflows', 'registry.yaml'), reg.join('\n') + '\n');

  // --- governance.yaml: policy + mechanical phase ledger + known drift ---
  const knownDrift = detectKnownDrift(fleet);
  const gov = [];
  gov.push('# GENERATED FILE — policy block is stable; ledger and drift sections');
  gov.push('# are regenerated from the live instance.');
  gov.push('# Regenerate with: node scripts/generate-registry.js');
  gov.push(`generated_at: ${yamlEscape(generatedAt)}`);
  gov.push('');
  gov.push('policy:');
  gov.push('  # Two real phases. Legacy ALPHA/BETA/GA phases appear in the ledger');
  gov.push('  # where live tags/names still carry them, but are not used for new work.');
  gov.push('  modifiable_phases: [DEV]');
  gov.push('  protected_phases: [ALPHA, BETA, GA, PROD, UTIL, ARCHIVED, UNPHASED]');
  gov.push('  deletion: forbidden  # retire by renaming with [ARCHIVED] prefix + deactivating');
  gov.push('  default_phase_for_new_workflows: DEV');
  gov.push('');
  gov.push('phase_counts:');
  for (const [phase, count] of Object.entries(phaseCounts).sort()) {
    gov.push(`  ${phase}: ${count}`);
  }
  gov.push('');
  gov.push('ledger:');
  for (const wf of fleet) {
    gov.push(`  ${yamlEscape(wf.id)}: { phase: ${phaseOf(wf)}, active: ${Boolean(wf.active)}, name: ${yamlEscape(wf.name)} }`);
  }
  gov.push('');
  gov.push('# Live-fleet drift from the naming/versioning doctrine, reported honestly');
  gov.push('# rather than papered over. Cleanup is tracked work, not a rewrite of history.');
  gov.push('known_drift:');
  gov.push(`  dual_active_versions: ${knownDrift.dual_active_versions.length === 0 ? '[]' : ''}`);
  for (const d of knownDrift.dual_active_versions) {
    gov.push(`    - base: ${yamlEscape(d.base)}`);
    gov.push(`      names: [${d.names.map(yamlEscape).join(', ')}]`);
  }
  gov.push(`  unphased_names: ${knownDrift.unphased_names.length === 0 ? '[]' : ''}`);
  for (const n of knownDrift.unphased_names) gov.push(`    - ${yamlEscape(n)}`);
  gov.push(`  version_suffix_names: ${knownDrift.version_suffix_names.length === 0 ? '[]' : ''}`);
  for (const n of knownDrift.version_suffix_names) gov.push(`    - ${yamlEscape(n)}`);
  fs.writeFileSync(path.join(ROOT, 'workflows', 'governance.yaml'), gov.join('\n') + '\n');

  console.log(`registry.yaml: ${fleet.length} workflows (${activeCount} active)`);
  console.log(`governance.yaml: phases ${JSON.stringify(phaseCounts)}`);
  console.log(`known drift: ${knownDrift.dual_active_versions.length} dual-active, ` +
    `${knownDrift.unphased_names.length} unphased, ${knownDrift.version_suffix_names.length} version-suffixed`);
}

main().catch((e) => { console.error(`generate-registry failed: ${e.message}`); process.exit(1); });
