# n8n webhook authentication

Generic n8n webhook surface in this repo requires a shared secret on every request:

- **Header:** `X-Webhook-Secret`
- **Source of truth (callers):** `N8N_WEBHOOK_SECRET` env var
- **Source of truth (n8n side):** a single Header Auth credential whose value matches the env var

Requests without the header (or with the wrong value) are rejected with `401`.

ElevenLabs vendor-signed webhooks use a different protocol — HMAC-SHA256 over `<timestamp>.<body>`, verified in-workflow with crypto nodes. Two of them are exhibited here: [`workflows/elevenlabs/post-call-webhook.json`](../workflows/elevenlabs/post-call-webhook.json) and [`workflows/elevenlabs/webhook-listener.json`](../workflows/elevenlabs/webhook-listener.json) (secrets redacted on export). Deeper eval-side tooling lives in [`wranngle/voice_ai_agent_evals`](https://github.com/wranngle/voice_ai_agent_evals). The rest of this doc covers the n8n shared-secret pattern.

## Applying the pattern to a workflow

The two scripts under `scripts/` are idempotent.

```bash
node scripts/secure-n8n-webhooks.js              # dry-run
node scripts/secure-n8n-webhooks.js --apply
node scripts/secure-internal-callers.js --apply  # patch HTTP Request nodes calling n8n webhooks
```

Pass `N8N_WEBHOOK_AUTH_CRED_ID=<your-cred-id>` to reuse an existing credential instead of creating a new one.

## Caller contract

JavaScript / TypeScript callers send:

```ts
headers: {
  "Content-Type": "application/json",
  "X-Webhook-Secret": process.env.N8N_WEBHOOK_SECRET,
}
```

Callers throw at startup if `N8N_WEBHOOK_SECRET` is missing — fail fast rather than silently produce 401s.

## Rotating the shared secret

1. Generate a new secret: `openssl rand -hex 32`.
2. Update the `X-Webhook-Secret` credential value in the n8n UI.
3. Update `N8N_WEBHOOK_SECRET` in your secrets store (`.env`, deployment secret manager, etc.).
4. Repatch any external caller that hardcodes the value rather than reading from env.

## Source JSONs

Workflow JSONs in this repo reference the credential by id. If you re-import any of them, the credential resolves automatically against the live tenant.
