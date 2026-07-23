#!/usr/bin/env node
/**
 * Secure every webhook in the deployed n8n tenant by binding it to a single
 * Header Auth credential. Idempotent: skips workflows that are already wired
 * to the target credential.
 *
 * Usage:
 *   node scripts/secure-n8n-webhooks.js              # dry-run + report
 *   node scripts/secure-n8n-webhooks.js --apply      # actually mutate
 *
 * WARNING (2026-07 audit): the HMAC_EXEMPT annotations below were written
 * against a January 2026 fleet and misidentify today's live workflows.
 * Running --apply without re-verifying the exemption list against
 * workflows/registry.yaml would bind Header Auth onto the three active
 * ElevenLabs HMAC receivers and break them. Re-verify before --apply.
 */

const env = require('./lib/env');

const APPLY = process.argv.includes('--apply');
const { client, hostname: HOST, port: PORT } = env.n8nTarget();
const API_KEY = env.require('N8N_API_KEY');
const SECRET = env.require('N8N_WEBHOOK_SECRET');
const CRED_NAME = 'X-Webhook-Secret (shared)';
const HEADER_NAME = 'X-Webhook-Secret';

// Workflows that MUST NOT have header auth — they receive HMAC-signed traffic
// from ElevenLabs. HMAC validation belongs inside the workflow itself.
// See docs/WEBHOOK_AUTH.md "HMAC exceptions".
const HMAC_EXEMPT = new Set([
  'cEORduJCqCVDOKce', // [DEV] ElevenLabs Call Completed - Update Pipedrive
  'FGjUvywqh09XKlYJ', // [DEV] Post-Call Bulletproof v2
]);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = client.request({
      hostname: HOST, port: PORT, path, method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(buf || '{}'); } catch { parsed = buf; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function listAllWorkflows() {
  let all = [], cursor = '';
  for (let i = 0; i < 50; i++) {
    const r = await request('GET', '/api/v1/workflows?limit=100' + (cursor ? '&cursor=' + cursor : ''));
    if (r.status !== 200) throw new Error(`list workflows failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    all = all.concat(r.body.data || []);
    if (!r.body.nextCursor) break;
    cursor = r.body.nextCursor;
  }
  return all;
}

async function ensureCredential() {
  if (process.env.N8N_WEBHOOK_AUTH_CRED_ID) return process.env.N8N_WEBHOOK_AUTH_CRED_ID;
  const r = await request('POST', '/api/v1/credentials', {
    name: CRED_NAME,
    type: 'httpHeaderAuth',
    data: { name: HEADER_NAME, value: SECRET },
  });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`credential create failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body.id;
}

const ALLOWED_PUT_FIELDS = ['name', 'nodes', 'connections', 'settings', 'staticData', 'pinData'];

function patchWebhookNodes(workflow, credId) {
  let changed = 0;
  for (const node of workflow.nodes || []) {
    if (node.type !== 'n8n-nodes-base.webhook') continue;
    node.parameters = node.parameters || {};
    const alreadyHeader = node.parameters.authentication === 'headerAuth';
    const sameCred = node.credentials?.httpHeaderAuth?.id === credId;
    if (alreadyHeader && sameCred) continue;
    node.parameters.authentication = 'headerAuth';
    node.credentials = node.credentials || {};
    node.credentials.httpHeaderAuth = { id: credId, name: CRED_NAME };
    changed++;
  }
  return changed;
}

function pickPutBody(workflow) {
  const body = {};
  for (const k of ALLOWED_PUT_FIELDS) {
    const v = workflow[k];
    if (v === undefined || v === null) continue;
    // n8n public API rejects empty staticData / pinData objects; omit them.
    if ((k === 'pinData' || k === 'staticData') && typeof v === 'object' && Object.keys(v).length === 0) continue;
    body[k] = v;
  }
  return body;
}

async function processWorkflow(meta, credId, results) {
  if (/^\[ARCHIVED\]/.test(meta.name)) { results.skipped.push({ id: meta.id, name: meta.name, reason: 'archived' }); return; }
  if (HMAC_EXEMPT.has(meta.id)) { results.skipped.push({ id: meta.id, name: meta.name, reason: 'HMAC-exempt (ElevenLabs)' }); return; }
  const r = await request('GET', `/api/v1/workflows/${meta.id}`);
  if (r.status !== 200) { results.errors.push({ id: meta.id, name: meta.name, stage: 'get', status: r.status, body: r.body }); return; }
  const wf = r.body;
  const webhooks = (wf.nodes || []).filter(n => n.type === 'n8n-nodes-base.webhook');
  if (webhooks.length === 0) { results.skipped.push({ id: meta.id, name: meta.name, reason: 'no webhook nodes' }); return; }

  const changed = patchWebhookNodes(wf, credId);
  if (changed === 0) { results.alreadyOk.push({ id: meta.id, name: meta.name, paths: webhooks.map(n => n.parameters?.path) }); return; }

  if (!APPLY) {
    results.wouldPatch.push({ id: meta.id, name: meta.name, changed, paths: webhooks.map(n => n.parameters?.path) });
    return;
  }

  const wasActive = !!meta.active;
  if (wasActive) {
    const d = await request('POST', `/api/v1/workflows/${meta.id}/deactivate`);
    if (d.status !== 200) { results.errors.push({ id: meta.id, name: meta.name, stage: 'deactivate', status: d.status, body: d.body }); return; }
  }

  const put = await request('PUT', `/api/v1/workflows/${meta.id}`, pickPutBody(wf));
  if (put.status !== 200) {
    results.errors.push({ id: meta.id, name: meta.name, stage: 'put', status: put.status, body: put.body });
    if (wasActive) await request('POST', `/api/v1/workflows/${meta.id}/activate`);
    return;
  }

  if (wasActive) {
    const a = await request('POST', `/api/v1/workflows/${meta.id}/activate`);
    if (a.status !== 200) { results.errors.push({ id: meta.id, name: meta.name, stage: 'reactivate', status: a.status, body: a.body }); return; }
  }

  results.patched.push({ id: meta.id, name: meta.name, changed, paths: webhooks.map(n => n.parameters?.path) });
}

(async () => {
  console.log(APPLY ? '== APPLYING ==' : '== DRY RUN (use --apply to mutate) ==');
  const workflows = await listAllWorkflows();
  console.log(`workflows: ${workflows.length}`);

  let credId;
  if (APPLY) {
    credId = await ensureCredential();
    console.log(`credential created: ${credId} (${CRED_NAME})`);
  } else {
    credId = '<DRY_RUN_CRED_ID>';
  }

  const results = { patched: [], wouldPatch: [], alreadyOk: [], skipped: [], errors: [] };
  for (const w of workflows) {
    try { await processWorkflow(w, credId, results); }
    catch (e) { results.errors.push({ id: w.id, name: w.name, stage: 'exception', error: String(e) }); }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`patched:     ${results.patched.length}`);
  console.log(`wouldPatch:  ${results.wouldPatch.length}`);
  console.log(`alreadyOk:   ${results.alreadyOk.length}`);
  console.log(`skipped:     ${results.skipped.length} (archived or no webhook)`);
  console.log(`errors:      ${results.errors.length}`);

  const detailed = APPLY ? results.patched : results.wouldPatch;
  if (detailed.length) {
    console.log('\n--- workflows with webhook nodes touched ---');
    for (const r of detailed) console.log(`${r.id}  ${r.name}  paths=${JSON.stringify(r.paths)}`);
  }
  if (results.alreadyOk.length) {
    console.log('\n--- workflows already wired correctly ---');
    for (const r of results.alreadyOk) console.log(`${r.id}  ${r.name}`);
  }
  if (results.errors.length) {
    console.log('\n--- ERRORS ---');
    for (const r of results.errors) console.log(JSON.stringify(r));
    process.exit(1);
  }

  if (APPLY) {
    console.log(`\nCredential id: ${credId}`);
    console.log('Save this id back into the source JSONs that use REPLACE_WITH_N8N_WEBHOOK_SECRET_CRED_ID.');
  }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
