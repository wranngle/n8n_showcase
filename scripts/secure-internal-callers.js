#!/usr/bin/env node
/**
 * Find every n8n HTTP Request node that targets another n8n webhook on the
 * same instance (<N8N_URL host>/webhook/...) and bind it to the shared
 * X-Webhook-Secret credential. Idempotent.
 *
 * Usage:
 *   node scripts/secure-internal-callers.js              # dry-run
 *   node scripts/secure-internal-callers.js --apply
 */

const env = require('./lib/env');

const APPLY = process.argv.includes('--apply');
const { client, hostname: HOST, port: PORT } = env.n8nTarget();
const API_KEY = env.require('N8N_API_KEY');
const CRED_ID = env.require('N8N_WEBHOOK_AUTH_CRED_ID');
const CRED_NAME = 'X-Webhook-Secret (shared)';

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
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve({status:res.statusCode,body:JSON.parse(d||'{}')})}catch{resolve({status:res.statusCode,body:d})} }); });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

const ALLOWED = ['name','nodes','connections','settings','staticData','pinData'];
function pickPutBody(w) {
  const body = {};
  for (const k of ALLOWED) {
    const v = w[k];
    if (v === undefined || v === null) continue;
    if ((k === 'pinData' || k === 'staticData') && typeof v === 'object' && Object.keys(v).length === 0) continue;
    body[k] = v;
  }
  return body;
}

// Match HTTP Request nodes that target another n8n webhook on this tenant.
const INTERNAL_WEBHOOK = new RegExp(
  HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?::\\d+)?/webhook/',
);
function isInternalN8nCall(node) {
  if (node.type !== 'n8n-nodes-base.httpRequest') return false;
  const url = node.parameters?.url;
  if (!url || typeof url !== 'string') return false;
  // Match literal <instance-host>/webhook/ AND expressions that include it.
  return INTERNAL_WEBHOOK.test(url);
}

function patchHttpNode(node) {
  node.parameters = node.parameters || {};
  // If it already uses our shared cred, skip.
  if (node.parameters.authentication === 'genericCredentialType' &&
      node.parameters.genericAuthType === 'httpHeaderAuth' &&
      node.credentials?.httpHeaderAuth?.id === CRED_ID) {
    return false;
  }
  node.parameters.authentication = 'genericCredentialType';
  node.parameters.genericAuthType = 'httpHeaderAuth';
  node.credentials = node.credentials || {};
  node.credentials.httpHeaderAuth = { id: CRED_ID, name: CRED_NAME };
  return true;
}

async function listAll() {
  let all = [], cursor = '';
  for (let i = 0; i < 50; i++) {
    const r = await request('GET','/api/v1/workflows?limit=100' + (cursor ? '&cursor=' + cursor : ''));
    if (r.status !== 200) throw new Error(`list failed ${r.status}`);
    all = all.concat(r.body.data || []);
    if (!r.body.nextCursor) break;
    cursor = r.body.nextCursor;
  }
  return all;
}

(async () => {
  console.log(APPLY ? '== APPLYING ==' : '== DRY RUN ==');
  const workflows = await listAll();
  const results = { patched: [], wouldPatch: [], skipped: [], errors: [] };

  for (const meta of workflows) {
    if (/^\[ARCHIVED\]/.test(meta.name)) { continue; }
    const r = await request('GET','/api/v1/workflows/' + meta.id);
    if (r.status !== 200) { results.errors.push({ id: meta.id, name: meta.name, stage: 'get', status: r.status, body: r.body }); continue; }
    const w = r.body;

    const internals = (w.nodes || []).filter(isInternalN8nCall);
    if (internals.length === 0) continue;

    let changed = 0;
    const detail = [];
    for (const node of internals) {
      const url = node.parameters.url;
      if (patchHttpNode(node)) { changed++; detail.push(node.name + ' -> ' + url); }
    }
    if (!changed) { results.skipped.push({ id: meta.id, name: meta.name, reason: 'already wired' }); continue; }

    if (!APPLY) { results.wouldPatch.push({ id: meta.id, name: meta.name, changed, detail }); continue; }

    const wasActive = !!meta.active;
    if (wasActive) await request('POST','/api/v1/workflows/'+meta.id+'/deactivate');
    const pr = await request('PUT','/api/v1/workflows/'+meta.id, pickPutBody(w));
    if (pr.status !== 200) {
      results.errors.push({ id: meta.id, name: meta.name, stage: 'put', status: pr.status, body: pr.body });
      if (wasActive) await request('POST','/api/v1/workflows/'+meta.id+'/activate');
      continue;
    }
    if (wasActive) {
      const a = await request('POST','/api/v1/workflows/'+meta.id+'/activate');
      if (a.status !== 200) results.errors.push({ id: meta.id, name: meta.name, stage: 'reactivate', status: a.status, body: a.body });
    }
    results.patched.push({ id: meta.id, name: meta.name, changed, detail });
  }

  console.log('\n=== SUMMARY ===');
  console.log(`patched:    ${results.patched.length}`);
  console.log(`wouldPatch: ${results.wouldPatch.length}`);
  console.log(`alreadyOk:  ${results.skipped.length}`);
  console.log(`errors:     ${results.errors.length}`);

  for (const r of (APPLY ? results.patched : results.wouldPatch)) {
    console.log(`\n${r.id}  ${r.name}  (${r.changed} nodes)`);
    for (const d of r.detail) console.log('  ' + d);
  }
  if (results.errors.length) {
    console.log('\n--- ERRORS ---');
    for (const r of results.errors) console.log(JSON.stringify(r));
    process.exit(1);
  }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
