'use strict';

// POST and PATCH are the non-idempotent verbs; PUT and DELETE are idempotent
// by HTTP semantics, so retrying them without a key is safe.
const MUTATING_HTTP_METHODS = new Set(['POST', 'PATCH']);
const IDEMPOTENCY_HEADER_PATTERN = /idempotency[-_ ]?key/i;

function hasRetryEnabled(node) {
  if (node.retryOnFail === true) return true;
  if (typeof node.maxTries === 'number' && node.maxTries > 1) return true;
  return false;
}

function listHeaderNames(node) {
  const params = node.parameters || {};
  const names = [];
  const collect = (container) => {
    if (!container || typeof container !== 'object') return;
    const params = container.parameters || container.parameter;
    if (Array.isArray(params)) {
      for (const p of params) {
        if (p && typeof p.name === 'string') names.push(p.name);
      }
    }
  };
  collect(params.headerParameters);
  collect(params.headers);
  if (Array.isArray(params.headerParametersUi?.parameter)) {
    for (const p of params.headerParametersUi.parameter) {
      if (p && typeof p.name === 'string') names.push(p.name);
    }
  }
  return names;
}

function hasIdempotencyKey(node) {
  return listHeaderNames(node).some((n) => IDEMPOTENCY_HEADER_PATTERN.test(n));
}

function isMutatingHttp(node) {
  if (node.type !== 'n8n-nodes-base.httpRequest') return false;
  const method = String(node.parameters?.method || 'GET').toUpperCase();
  return MUTATING_HTTP_METHODS.has(method);
}

module.exports = {
  id: 'retry-without-idempotency',
  description: 'HTTP nodes with retry enabled that perform mutating writes must send an Idempotency-Key header.',
  check(workflow) {
    const findings = [];
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    for (const node of nodes) {
      if (!isMutatingHttp(node)) continue;
      if (!hasRetryEnabled(node)) continue;
      if (hasIdempotencyKey(node)) continue;
      findings.push({
        nodeId: node.id || node.name,
        nodeName: node.name,
        message: `node "${node.name}" retries mutating ${node.parameters?.method || 'POST'} without an Idempotency-Key header`,
      });
    }
    return findings;
  },
};
