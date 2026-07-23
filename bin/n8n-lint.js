#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { runRules, listRules } = require('../lib/lint/registry');

const USAGE = `Usage: n8n-lint <workflow.json | dir> [<more...>] [--only rule1,rule2] [--skip rule3] [--json] [--baseline file.json] [--list-rules]

Lints n8n workflow JSON files using a registry of custom rules:
${listRules()
  .map((r) => `  - ${r.id}: ${r.description}`)
  .join('\n')}

Exits non-zero if any rule emits a finding. With --baseline, exits non-zero
only when a rule's finding count EXCEEDS the count recorded in the baseline
file ({ruleId: count}) — a ratchet: existing debt is tracked, new debt is
blocked, and shrinking counts should be locked in by lowering the baseline.`;

function parseArgs(argv) {
  const args = { paths: [], only: null, skip: null, json: false, listRules: false, help: false, baseline: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--list-rules') {
      args.listRules = true;
    } else if (a === '--json') {
      args.json = true;
    } else if (a === '--baseline') {
      args.baseline = argv[++i] || null;
    } else if (a === '--only') {
      args.only = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--skip') {
      args.skip = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith('--')) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      args.paths.push(a);
    }
  }
  return args;
}

function* iterateWorkflowFiles(p) {
  const stat = fs.statSync(p);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(p)) {
      const child = path.join(p, entry);
      const cs = fs.statSync(child);
      if (cs.isDirectory()) {
        yield* iterateWorkflowFiles(child);
      } else if (entry.endsWith('.json')) {
        yield child;
      }
    }
  } else if (stat.isFile()) {
    yield p;
  }
}

function lintFile(file, opts) {
  const raw = fs.readFileSync(file, 'utf8');
  let wf;
  try {
    wf = JSON.parse(raw);
  } catch (err) {
    return [{
      rule: 'parse-error',
      nodeId: '',
      nodeName: '',
      message: `invalid JSON: ${err.message}`,
    }];
  }
  return runRules(wf, { only: opts.only, skip: opts.skip });
}

function formatHuman(file, findings) {
  if (findings.length === 0) return `OK  ${file}`;
  const lines = [`FAIL ${file}`];
  for (const f of findings) {
    const where = f.nodeName ? ` [${f.nodeName}]` : '';
    lines.push(`  - ${f.rule}${where}: ${f.message}`);
  }
  return lines.join('\n');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n${USAGE}\n`);
    process.exit(2);
  }
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  if (args.listRules) {
    if (args.json) {
      process.stdout.write(`${JSON.stringify(listRules(), null, 2)}\n`);
    } else {
      for (const r of listRules()) process.stdout.write(`${r.id}\t${r.description}\n`);
    }
    process.exit(0);
  }
  if (args.paths.length === 0) {
    process.stderr.write(`error: no workflow paths provided\n${USAGE}\n`);
    process.exit(2);
  }

  const allFindings = [];
  const fileResults = [];
  for (const root of args.paths) {
    if (!fs.existsSync(root)) {
      process.stderr.write(`error: path not found: ${root}\n`);
      process.exit(2);
    }
    for (const file of iterateWorkflowFiles(root)) {
      const findings = lintFile(file, args);
      fileResults.push({ file, findings });
      for (const f of findings) allFindings.push({ file, ...f });
    }
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ findings: allFindings }, null, 2)}\n`);
  } else {
    for (const { file, findings } of fileResults) {
      process.stdout.write(`${formatHuman(file, findings)}\n`);
    }
    if (allFindings.length > 0) {
      process.stderr.write(`\nfound ${allFindings.length} issue(s) across ${fileResults.length} file(s)\n`);
      const rules = Array.from(new Set(allFindings.map((f) => f.rule))).sort();
      process.stderr.write(`rules triggered: ${rules.join(', ')}\n`);
    }
  }

  if (args.baseline) {
    const baseline = JSON.parse(fs.readFileSync(args.baseline, 'utf8'));
    const counts = {};
    for (const f of allFindings) counts[f.rule] = (counts[f.rule] || 0) + 1;
    let regressions = 0;
    for (const [rule, count] of Object.entries(counts)) {
      const allowed = baseline[rule] || 0;
      if (count > allowed) {
        process.stderr.write(`baseline: ${rule} regressed (${count} > allowed ${allowed})\n`);
        regressions += 1;
      } else if (count < allowed) {
        process.stderr.write(`baseline: ${rule} improved (${count} < allowed ${allowed}) — lower the baseline to lock it in\n`);
      }
    }
    process.exit(regressions > 0 ? 1 : 0);
  }
  process.exit(allFindings.length > 0 ? 1 : 0);
}

main();
