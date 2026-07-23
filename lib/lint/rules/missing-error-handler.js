'use strict';

const FALLIBLE_TYPE_PREFIXES = [
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.postgres',
  'n8n-nodes-base.mysql',
  'n8n-nodes-base.emailSend',
  'n8n-nodes-base.executeWorkflow',
  'n8n-nodes-base.twilio',
  'n8n-nodes-base.stripe',
];

function isFallible(node) {
  const type = typeof node.type === 'string' ? node.type : '';
  return FALLIBLE_TYPE_PREFIXES.some((p) => type === p || type.startsWith(`${p}.`));
}

function hasContinueOnFail(node) {
  if (node.continueOnFail === true) return true;
  if (typeof node.onError === 'string' && node.onError !== 'stopWorkflow') return true;
  return false;
}

module.exports = {
  id: 'missing-error-handler',
  description: 'Fallible nodes (HTTP, DB, email, executeWorkflow, payment) must declare an onError/continueOnFail policy, or the workflow must route errors to an errorWorkflow.',
  check(workflow) {
    const findings = [];
    // A workflow-level error workflow catches every node failure.
    if (workflow.settings && workflow.settings.errorWorkflow) return findings;
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    for (const node of nodes) {
      if (!isFallible(node)) continue;
      if (hasContinueOnFail(node)) continue;
      findings.push({
        nodeId: node.id || node.name,
        nodeName: node.name,
        message: `fallible node "${node.name}" (${node.type}) has no continueOnFail/onError policy and the workflow has no errorWorkflow`,
      });
    }
    return findings;
  },
};
