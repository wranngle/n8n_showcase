#!/usr/bin/env bats
# tests/n8n_showcase.bats — single test file per project (doctrine).
#
# Concerns, grouped by comment headers:
#   sanitizer — the publish gate that makes live exports safe to check in
#   verify — the forbidden-key gate over checked-in exhibits
#   governance — doctrine validation over checked-in exhibits
#   lint — rule behavior on fixtures + the ratchet baseline over exhibits
#   diff — deterministic workflow diffing
#   installer — payload projection for POST /api/v1/workflows
#   coherence — manifest <-> disk <-> tool-constant drift checks

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

setup() {
  cd "$REPO_ROOT"
  TMP="$(mktemp -d)"
}

teardown() {
  rm -rf "$TMP"
}

# ---------------------------------------------------------------- sanitizer

@test "sanitize: output of a raw API export contains none of verify's forbidden keys" {
  node scripts/sanitize-workflow.js fixtures/sanitize/raw.json "$TMP/out.json" 2>/dev/null
  run node -e "
    const { findForbidden } = require('$REPO_ROOT/scripts/verify-workflows.js');
    const wf = JSON.parse(require('fs').readFileSync('$TMP/out.json', 'utf8'));
    const found = [...findForbidden(wf)];
    if (found.length) { console.error('leaked keys: ' + found.join(',')); process.exit(1); }
  "
  [ "$status" -eq 0 ]
}

@test "sanitize: every secret class in the fixture is redacted, none survive raw" {
  node scripts/sanitize-workflow.js fixtures/sanitize/raw.json "$TMP/out.json" 2>/dev/null
  for marker in elevenlabs-api-key elevenlabs-webhook-secret google-api-key twilio-account-sid jwt elevenlabs-agent-id elevenlabs-phone-id phone; do
    grep -q "<REDACTED:$marker>" "$TMP/out.json" || { echo "missing redaction marker: $marker"; return 1; }
  done
  run grep -cE 'sk_[a-f0-9]{40}|wsec_[a-f0-9]{30}|AIza[A-Za-z0-9_-]{35}|AC[a-f0-9]{32}|\+1[0-9]{10}' "$TMP/out.json"
  [ "$status" -ne 0 ]
}

@test "sanitize: same input yields byte-identical output across runs" {
  node scripts/sanitize-workflow.js fixtures/sanitize/raw.json "$TMP/a.json" 2>/dev/null
  node scripts/sanitize-workflow.js fixtures/sanitize/raw.json "$TMP/b.json" 2>/dev/null
  cmp "$TMP/a.json" "$TMP/b.json"
}

# ------------------------------------------------------------------- verify

@test "verify: the checked-in exhibits pass the forbidden-key gate" {
  run node scripts/verify-workflows.js
  [ "$status" -eq 0 ]
}

@test "coherence: every key verify forbids is a key the sanitizer strips" {
  run node -e "
    const v = require('$REPO_ROOT/scripts/verify-workflows.js');
    const s = require('$REPO_ROOT/scripts/sanitize-workflow.js');
    const stripped = new Set([...s.STRIP_TOP_LEVEL, ...s.STRIP_NODE_LEVEL]);
    const missing = v.FORBIDDEN_KEYS.filter((k) => !stripped.has(k));
    if (missing.length) { console.error('verify forbids keys sanitizer never strips: ' + missing.join(',')); process.exit(1); }
  "
  [ "$status" -eq 0 ]
}

# --------------------------------------------------------------- governance

@test "governance: checked-in exhibits produce zero errors" {
  run node scripts/governance-engine.js
  [ "$status" -eq 0 ]
  [[ "$output" == *", 0 errors,"* ]]
}

@test "governance: a workflow retaining a credentials block is an error" {
  mkdir -p "$TMP/wf"
  node -e "
    const fs = require('fs');
    const wf = JSON.parse(fs.readFileSync('$REPO_ROOT/fixtures/lint/clean.json', 'utf8'));
    wf.nodes[0].credentials = { httpHeaderAuth: { id: 'x', name: 'y' } };
    fs.writeFileSync('$TMP/wf/bad.json', JSON.stringify(wf));
  "
  run node scripts/governance-engine.js "$TMP/wf"
  [ "$status" -eq 1 ]
  [[ "$output$stderr" == *"forbidden keys: credentials"* ]] || [[ "$output" == *"1 errors"* ]]
}

@test "governance: a banned LLM model reference is an error" {
  mkdir -p "$TMP/wf"
  node -e "
    const fs = require('fs');
    const wf = JSON.parse(fs.readFileSync('$REPO_ROOT/fixtures/lint/clean.json', 'utf8'));
    wf.nodes[1].parameters.model = 'gpt-4o-mini';
    fs.writeFileSync('$TMP/wf/banned.json', JSON.stringify(wf));
  "
  run node scripts/governance-engine.js "$TMP/wf"
  [ "$status" -eq 1 ]
}

# --------------------------------------------------------------------- lint

@test "lint: dirty fixture triggers all four rule classes" {
  run node bin/n8n-lint.js fixtures/lint/dirty.json
  [ "$status" -eq 1 ]
  [[ "$output" == *"hardcoded-secrets"* ]]
  [[ "$output" == *"missing-error-handler"* ]]
  [[ "$output" == *"pii-in-node-name"* ]]
  [[ "$output" == *"retry-without-idempotency"* ]]
}

@test "lint: clean fixture passes with zero findings" {
  run node bin/n8n-lint.js fixtures/lint/clean.json
  [ "$status" -eq 0 ]
}

@test "lint: an ElevenLabs-shaped key is detected (the platform's own key class)" {
  run node bin/n8n-lint.js fixtures/lint/dirty.json
  [[ "$output" == *"elevenlabs-key"* ]]
}

@test "lint ratchet: exhibit findings do not exceed the committed baseline" {
  run node bin/n8n-lint.js workflows --baseline lint-baseline.json
  [ "$status" -eq 0 ]
}

@test "lint ratchet: a regression beyond the baseline fails" {
  echo '{}' > "$TMP/zero-baseline.json"
  run node bin/n8n-lint.js fixtures/lint/dirty.json --baseline "$TMP/zero-baseline.json"
  [ "$status" -eq 1 ]
}

# --------------------------------------------------------------------- diff

@test "diff: added and removed nodes both appear with their signs" {
  run node scripts/n8n-diff.js fixtures/diff/a.json fixtures/diff/b.json
  [ "$status" -eq 0 ]
  [[ "$output" == *"+"* ]]
  [[ "$output" == *"-"* ]]
}

@test "diff: byte-identical output across two runs" {
  node scripts/n8n-diff.js fixtures/diff/a.json fixtures/diff/b.json --out "$TMP/d1.md"
  node scripts/n8n-diff.js fixtures/diff/a.json fixtures/diff/b.json --out "$TMP/d2.md"
  cmp "$TMP/d1.md" "$TMP/d2.md"
}

# ---------------------------------------------------------------- installer

@test "install payload: only API-accepted keys survive projection" {
  run node -e "
    const { projectPayload, INSTALL_KEYS } = require('$REPO_ROOT/scripts/install-workflow.js');
    const wf = JSON.parse(require('fs').readFileSync('$REPO_ROOT/workflows/lead-intake/form-receiver.json', 'utf8'));
    const p = projectPayload(wf);
    const extra = Object.keys(p).filter((k) => !INSTALL_KEYS.includes(k));
    if (extra.length) { console.error('extra keys: ' + extra.join(',')); process.exit(1); }
    if (!p.name || p.nodes.length === 0) process.exit(1);
  "
  [ "$status" -eq 0 ]
}

@test "install payload: a workflow with no nodes is rejected before any network call" {
  run node -e "
    const { projectPayload } = require('$REPO_ROOT/scripts/install-workflow.js');
    try { projectPayload({ name: 'x', nodes: [] }); process.exit(0); }
    catch (e) { process.exit(3); }
  "
  [ "$status" -eq 3 ]
}

# ---------------------------------------------------------------- coherence

@test "coherence: manifest and workflows/ agree exactly (no ghost exhibits either way)" {
  run node -e "
    const fs = require('fs');
    const path = require('path');
    const yaml = require('js-yaml');
    const root = '$REPO_ROOT';
    const { exhibits } = yaml.load(fs.readFileSync(path.join(root, 'workflows/exhibits.yaml'), 'utf8'));
    const manifest = new Set(exhibits.map((e) => e.file));
    const onDisk = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d)) {
        const f = path.join(d, e);
        if (fs.statSync(f).isDirectory()) walk(f);
        else if (e.endsWith('.json')) onDisk.push(path.relative(root, f));
      }
    })(path.join(root, 'workflows'));
    const missing = [...manifest].filter((f) => !onDisk.includes(f));
    const unlisted = onDisk.filter((f) => !manifest.has(f));
    if (missing.length || unlisted.length) {
      console.error('manifest-only: ' + missing.join(',') + ' | disk-only: ' + unlisted.join(','));
      process.exit(1);
    }
  "
  [ "$status" -eq 0 ]
}

@test "drift internals: phase resolution prefers tags over name prefix" {
  run node -e "
    const { phaseOf } = require('$REPO_ROOT/lib/drift');
    const byTag = phaseOf({ name: '[PROD] x', tags: [{ name: 'ARCHIVED' }] });
    const byPrefix = phaseOf({ name: '[PROD] x', tags: [] });
    const unphased = phaseOf({ name: 'elevenlabs_thing', tags: [] });
    if (byTag !== 'ARCHIVED' || byPrefix !== 'PROD' || unphased !== 'UNPHASED') {
      console.error(byTag, byPrefix, unphased); process.exit(1);
    }
  "
  [ "$status" -eq 0 ]
}

@test "drift internals: a drifted exhibit is reported and counted" {
  run node -e "
    const { renderReport } = require('$REPO_ROOT/lib/drift');
    const report = renderReport({
      results: [
        { file: 'workflows/a.json', liveName: '[DEV] a', status: 'in-sync' },
        { file: 'workflows/b.json', liveName: '[DEV] b', status: 'drifted', liveHash: 'aaa', repoHash: 'bbb' },
      ],
      fleet: { total: 2, active: 1, byPhase: { DEV: 2 } },
      n8nUrl: 'https://example.invalid', generatedAt: '2026-01-01T00:00:00Z',
    });
    if (!report.includes('drifted') || !report.includes('Drifted or missing: 1')) process.exit(1);
    if (!report.includes('export-live-workflows')) process.exit(1);
  "
  [ "$status" -eq 0 ]
}
