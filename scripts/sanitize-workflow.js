#!/usr/bin/env node
/**
 * sanitize-workflow.js — turn a raw n8n API workflow export into a
 * publishable exhibit.
 *
 * Strips instance state (ids, versions, timestamps, pinData, staticData,
 * credentials, webhookIds), flattens tags to names, and redacts secret- or
 * PII-shaped strings anywhere in the payload. Every redaction is recorded so
 * the caller can print a receipt.
 *
 * Usage:
 *   node scripts/sanitize-workflow.js <raw.json >sanitized.json
 *   node scripts/sanitize-workflow.js raw.json sanitized.json
 *
 * Module API: sanitizeWorkflow(raw) -> { workflow, report }
 * Output is deterministic: same input bytes -> same output bytes.
 */

const fs = require('fs');

// Workflow-level keys that are instance state, not design.
const STRIP_TOP_LEVEL = [
  'id', 'versionId', 'activeVersion', 'activeVersionId', 'versionCounter',
  'createdAt', 'updatedAt', 'shared', 'staticData', 'pinData', 'triggerCount',
  'meta', 'isArchived',
];

// Node-level keys that are instance state.
const STRIP_NODE_LEVEL = ['webhookId', 'credentials'];

// Secret- and PII-shaped string patterns. Order matters: more specific first.
const REDACTIONS = [
  { label: 'elevenlabs-api-key', re: /sk_[a-f0-9]{40,}/g },
  { label: 'elevenlabs-webhook-secret', re: /wsec_[a-f0-9]{30,}/g },
  { label: 'openai-api-key', re: /sk-[A-Za-z0-9_-]{30,}/g },
  { label: 'google-api-key', re: /AIza[A-Za-z0-9_-]{35}/g },
  { label: 'twilio-account-sid', re: /AC[a-f0-9]{32}/g },
  { label: 'twilio-content-sid', re: /HX[a-f0-9]{32}/g },
  { label: 'jwt', re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.?[A-Za-z0-9_-]*/g },
  { label: 'elevenlabs-agent-id', re: /agent_[a-z0-9]{20,}/g },
  { label: 'elevenlabs-phone-id', re: /phnum_[a-z0-9]{20,}/g },
  { label: 'phone', re: /\+1\d{10}/g },
  { label: 'hex-secret', re: /\b[a-f0-9]{48,}\b/g },
];

function redactString(value, report) {
  let out = value;
  for (const { label, re } of REDACTIONS) {
    out = out.replace(re, (match) => {
      report.redactions.push({ label, sample: match.slice(0, 6) + '…' });
      return `<REDACTED:${label}>`;
    });
  }
  return out;
}

function redactDeep(node, report) {
  if (typeof node === 'string') return redactString(node, report);
  if (Array.isArray(node)) return node.map((item) => redactDeep(item, report));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = redactDeep(v, report);
    return out;
  }
  return node;
}

function sanitizeWorkflow(raw) {
  const report = { strippedKeys: [], redactions: [] };
  const wf = {};

  for (const [k, v] of Object.entries(raw)) {
    if (STRIP_TOP_LEVEL.includes(k)) {
      report.strippedKeys.push(k);
      continue;
    }
    wf[k] = v;
  }

  // Tags: keep names only — tag ids are instance state.
  if (Array.isArray(wf.tags)) {
    wf.tags = wf.tags
      .map((t) => (t && typeof t === 'object' ? t.name : t))
      .filter((t) => typeof t === 'string');
  }

  if (Array.isArray(wf.nodes)) {
    wf.nodes = wf.nodes.map((node) => {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        if (STRIP_NODE_LEVEL.includes(k)) {
          report.strippedKeys.push(`nodes[].${k}`);
          continue;
        }
        out[k] = v;
      }
      return out;
    });
  }

  const clean = redactDeep(wf, report);
  report.strippedKeys = [...new Set(report.strippedKeys)].sort();
  return { workflow: clean, report };
}

function serialize(workflow) {
  return JSON.stringify(workflow, null, 2) + '\n';
}

if (require.main === module) {
  const [inPath, outPath] = process.argv.slice(2);
  const input = inPath ? fs.readFileSync(inPath, 'utf8') : fs.readFileSync(0, 'utf8');
  const { workflow, report } = sanitizeWorkflow(JSON.parse(input));
  const output = serialize(workflow);
  if (outPath) fs.writeFileSync(outPath, output);
  else process.stdout.write(output);
  const counts = {};
  for (const r of report.redactions) counts[r.label] = (counts[r.label] || 0) + 1;
  const summary = Object.entries(counts).map(([l, n]) => `${l}×${n}`).join(', ');
  process.stderr.write(
    `sanitize: stripped [${report.strippedKeys.join(', ')}]` +
    (summary ? `; redacted ${summary}` : '; no redactions') + '\n'
  );
}

module.exports = { sanitizeWorkflow, serialize, REDACTIONS };
