#!/usr/bin/env node
/**
 * verify-workflows.js — CI gate for the exhibit library.
 *
 * Validates that every workflow under `workflows/` parses cleanly as JSON
 * and contains none of the keys scripts/sanitize-workflow.js strips
 * (credentials, pinData, webhookId, meta.instanceId, staticData).
 *
 * Exits 0 on clean; non-zero with a summary on failure.
 */

const fs = require('fs');
const path = require('path');

const FORBIDDEN_KEYS = ['credentials', 'pinData', 'webhookId', 'staticData'];
const WORKFLOWS_DIR = path.join(__dirname, '..', 'workflows');

function findWorkflows(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      findWorkflows(full, results);
    } else if (entry.endsWith('.json')) {
      results.push(full);
    }
  }
  return results;
}

function findForbidden(node, found = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) findForbidden(item, found);
  } else if (node && typeof node === 'object') {
    for (const key of FORBIDDEN_KEYS) {
      if (key in node) found.add(key);
    }
    if (node.meta && typeof node.meta === 'object' && 'instanceId' in node.meta) {
      found.add('meta.instanceId');
    }
    for (const k of Object.keys(node)) findForbidden(node[k], found);
  }
  return found;
}

function main() {
  const files = findWorkflows(WORKFLOWS_DIR);
  const failures = [];

  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      failures.push({file, kind: 'parse', detail: e.message});
      continue;
    }
    const found = findForbidden(parsed);
    if (found.size > 0) {
      failures.push({file, kind: 'sanitization', detail: [...found].join(',')});
    }
  }

  if (failures.length === 0) {
    console.log(`OK: ${files.length} workflow${files.length === 1 ? '' : 's'} parsed cleanly; no forbidden keys.`);
    process.exit(0);
  }

  console.error(`FAIL: ${failures.length} workflow issue${failures.length === 1 ? '' : 's'} across ${files.length} file${files.length === 1 ? '' : 's'}:`);
  for (const f of failures) {
    console.error(`  [${f.kind}] ${path.relative(process.cwd(), f.file)} :: ${f.detail}`);
  }
  process.exit(1);
}

if (require.main === module) main();

module.exports = { FORBIDDEN_KEYS, findForbidden, findWorkflows };
