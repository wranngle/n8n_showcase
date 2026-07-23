#!/usr/bin/env node
/**
 * governance-engine.js — validate every checked-in workflow exhibit against
 * project doctrine (CLAUDE.md).
 *
 * ERRORS (exit 1 — repo-controllable, must be fixed before merge):
 *   - JSON parse failure
 *   - empty or missing nodes array / missing name
 *   - forbidden sanitization keys present (credentials, pinData, webhookId,
 *     staticData, meta.instanceId)
 *   - banned LLM models referenced anywhere in node parameters
 *
 * WARNINGS (reported, non-blocking — they mirror live-fleet drift the
 * exhibits faithfully reproduce; fixing them means fixing the instance):
 *   - LLM APIs called from httpRequest/code nodes (doctrine: use LangChain nodes)
 *   - IF nodes (doctrine: prefer Switch — n8n IF v2.2 routing bugs)
 *   - live name missing a [PHASE] prefix, or carrying a version suffix
 *
 * Usage: node scripts/governance-engine.js [workflows-dir]
 */

const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.resolve(process.argv[2] || path.join(__dirname, '..', 'workflows'));

const FORBIDDEN_KEYS = ['credentials', 'pinData', 'webhookId', 'staticData'];

const BANNED_MODELS = [
  'gpt-4o-mini', 'gemini-2.0-flash-001', 'gemini-1.5-flash', 'claude-3-haiku', 'gpt-5-mini',
];

const BLOCKED_LLM_HOSTS = [
  'openrouter.ai', 'api.openai.com/v1/chat', 'generativelanguage.googleapis.com',
  'api.anthropic.com', 'api.cohere.ai', 'api.mistral.ai', 'api.together.xyz', 'api.groq.com',
];

function findWorkflows(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) findWorkflows(full, results);
    else if (entry.endsWith('.json')) results.push(full);
  }
  return results;
}

function deepFindKeys(node, keys, found = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) deepFindKeys(item, keys, found);
  } else if (node && typeof node === 'object') {
    for (const key of keys) if (key in node) found.add(key);
    if (node.meta && typeof node.meta === 'object' && 'instanceId' in node.meta) {
      found.add('meta.instanceId');
    }
    for (const k of Object.keys(node)) deepFindKeys(node[k], keys, found);
  }
  return found;
}

function checkWorkflow(file) {
  const errors = [];
  const warnings = [];
  const rel = path.relative(process.cwd(), file);

  let wf;
  try {
    wf = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { file: rel, errors: [`parse: ${e.message}`], warnings };
  }

  if (typeof wf.name !== 'string' || wf.name.length === 0) errors.push('missing name');
  if (!Array.isArray(wf.nodes) || wf.nodes.length === 0) errors.push('empty nodes array');

  const forbidden = deepFindKeys(wf, FORBIDDEN_KEYS);
  if (forbidden.size > 0) errors.push(`forbidden keys: ${[...forbidden].sort().join(', ')}`);

  const text = JSON.stringify(wf);
  for (const model of BANNED_MODELS) {
    if (text.includes(model)) errors.push(`banned model: ${model}`);
  }

  for (const node of wf.nodes || []) {
    const type = String(node.type || '');
    if (type === 'n8n-nodes-base.if') {
      warnings.push(`IF node "${node.name}" (doctrine: prefer Switch — IF v2.2 routing bugs)`);
    }
    if (type === 'n8n-nodes-base.httpRequest' || type === 'n8n-nodes-base.code') {
      const nodeText = JSON.stringify(node.parameters || {});
      for (const host of BLOCKED_LLM_HOSTS) {
        if (nodeText.includes(host)) {
          warnings.push(`LLM-over-HTTP in "${node.name}" (${host}) — doctrine: use LangChain nodes`);
        }
      }
    }
  }

  if (typeof wf.name === 'string') {
    if (!/^\[[A-Z]+\]/.test(wf.name)) {
      warnings.push(`live name has no [PHASE] prefix: "${wf.name}"`);
    }
    if (/\/\s*v\d+\b/.test(wf.name)) {
      warnings.push(`live name carries a version suffix: "${wf.name}"`);
    }
  }

  return { file: rel, errors, warnings };
}

function main() {
  const files = findWorkflows(WORKFLOWS_DIR);
  if (files.length === 0) {
    console.error(`governance: no workflow JSON found under ${WORKFLOWS_DIR}`);
    process.exit(1);
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const file of files) {
    const { file: rel, errors, warnings } = checkWorkflow(file);
    for (const e of errors) console.error(`ERROR ${rel}: ${e}`);
    for (const w of warnings) console.log(`warn  ${rel}: ${w}`);
    errorCount += errors.length;
    warningCount += warnings.length;
  }

  console.log(`governance: ${files.length} workflows, ${errorCount} errors, ${warningCount} warnings`);
  process.exit(errorCount === 0 ? 0 : 1);
}

if (require.main === module) main();

module.exports = { checkWorkflow, FORBIDDEN_KEYS, BANNED_MODELS, BLOCKED_LLM_HOSTS };
