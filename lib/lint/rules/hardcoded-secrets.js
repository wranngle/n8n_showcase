'use strict';

const SECRET_PATTERNS = [
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bghp_[A-Za-z0-9]{30,}\b/ },
  { id: 'github-fine-grained-token', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'stripe-key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { id: 'elevenlabs-key', re: /\bsk_[a-f0-9]{40,}\b/ },
  { id: 'elevenlabs-webhook-secret', re: /\bwsec_[a-f0-9]{30,}\b/ },
  { id: 'google-api-key', re: /\bAIza[A-Za-z0-9_-]{35}\b/ },
  { id: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'twilio-sid', re: /\bAC[0-9a-f]{32}\b/ },
  { id: 'bearer-jwt', re: /\beyJ[A-Za-z0-9_=-]{10,}\.[A-Za-z0-9_=-]{10,}\.[A-Za-z0-9_.+/=-]{10,}\b/ },
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
];

function findSecretInString(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  for (const { id, re } of SECRET_PATTERNS) {
    if (re.test(value)) return id;
  }
  return null;
}

function walk(value, path, hits) {
  if (value == null) return;
  if (typeof value === 'string') {
    const hit = findSecretInString(value);
    if (hit) hits.push({ path: path.join('.'), kind: hit });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, [...path, String(i)], hits));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      walk(v, [...path, k], hits);
    }
  }
}

module.exports = {
  id: 'hardcoded-secrets',
  description: 'Node parameters must not contain hardcoded secrets — use n8n credentials or env vars.',
  check(workflow) {
    const findings = [];
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    for (const node of nodes) {
      const params = node.parameters || {};
      const hits = [];
      walk(params, [], hits);
      for (const hit of hits) {
        findings.push({
          nodeId: node.id || node.name,
          nodeName: node.name,
          message: `hardcoded ${hit.kind} found in parameters.${hit.path}`,
        });
      }
    }
    return findings;
  },
};
