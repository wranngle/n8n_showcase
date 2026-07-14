# n8n_showcase — documentation

This repo is the canonical sanitized n8n workflow library: lead intake, enrichment, post-call processing, security middleware. Generic n8n surface only — voice-agent / ElevenLabs-specific code lives at [`wranngle/voice_ai_agent_evals`](https://github.com/wranngle/voice_ai_agent_evals).

## Documents

| Document | Description |
|---|---|
| [Architecture](../ARCHITECTURE.md) | System design, data flows, governance |
| [Webhook Auth](WEBHOOK_AUTH.md) | Shared-secret pattern for n8n webhooks |

## Workflow governance

The repo enforces a DEV-only modification policy (active workflows live in `workflows/`; deprecated workflows are archived, never deleted). New workflows auto-tag as DEV.

## Related resources

- [n8n documentation](https://docs.n8n.io/)
- `workflows/governance.yaml` — workflow phase tracking
- `scripts/` — workflow API utilities, security middleware, governance
