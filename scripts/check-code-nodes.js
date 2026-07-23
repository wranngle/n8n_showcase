#!/usr/bin/env node
/**
 * check-code-nodes.js — syntax-check the JavaScript inside every Code node
 * of every checked-in workflow.
 *
 * n8n executes jsCode in an async function scope (top-level `return` and
 * `await` are legal), so each snippet is compiled as an async function body:
 * a SyntaxError there is a SyntaxError in production.
 *
 * Usage: node scripts/check-code-nodes.js [workflows-dir]
 */

const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.resolve(process.argv[2] || path.join(__dirname, '..', 'workflows'));

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function findWorkflows(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) findWorkflows(full, results);
    else if (entry.endsWith('.json')) results.push(full);
  }
  return results;
}

let checked = 0;
let failures = 0;

for (const file of findWorkflows(WORKFLOWS_DIR)) {
  const rel = path.relative(process.cwd(), file);
  let wf;
  try {
    wf = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    continue; // parse failures are verify-workflows' job
  }
  for (const node of wf.nodes || []) {
    const code = node.parameters && node.parameters.jsCode;
    if (typeof code !== 'string' || code.length === 0) continue;
    checked += 1;
    try {
      new AsyncFunction(code);
    } catch (e) {
      failures += 1;
      console.error(`SYNTAX ${rel} :: node "${node.name}" :: ${e.message}`);
    }
  }
}

console.log(`code-nodes: ${checked} snippets checked, ${failures} syntax failures`);
process.exit(failures === 0 ? 0 : 1);
