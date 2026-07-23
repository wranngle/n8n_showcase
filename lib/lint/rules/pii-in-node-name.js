'use strict';

// Order matters: specific shapes first, or the broad phone pattern shadows
// them (a 16-digit card number is also "8+ digits").
const PII_PATTERNS = [
  { id: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { id: 'credit-card', re: /\b(?:\d[ -]?){13,19}\b/ },
  { id: 'email', re: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { id: 'phone', re: /\b(?:\+?\d[\s.-]?){7,}\d\b/ },
];

function checkName(name) {
  for (const { id, re } of PII_PATTERNS) {
    if (re.test(name)) return id;
  }
  return null;
}

module.exports = {
  id: 'pii-in-node-name',
  description: 'Node names must not contain personally identifiable information (email, phone, SSN, credit card).',
  check(workflow) {
    const findings = [];
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    for (const node of nodes) {
      const name = typeof node.name === 'string' ? node.name : '';
      const hit = checkName(name);
      if (hit) {
        findings.push({
          nodeId: node.id || name,
          nodeName: name,
          message: `node name contains ${hit}-shaped PII: ${JSON.stringify(name)}`,
        });
      }
    }
    return findings;
  },
};
