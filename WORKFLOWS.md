# Exhibit index

Every workflow JSON in this repo is a sanitized export of a live workflow on
n8n.wranngle.com, produced by `npm run export` and held in sync by
`npm run drift` (scheduled daily in CI). The manifest that binds file to live
id is [`workflows/exhibits.yaml`](workflows/exhibits.yaml).

Phase comes from live n8n tags first, then the name prefix. "Active" is the
live activation state at the last registry refresh; some exhibits (the
bulletproof caller, pipedrive-updater, the DLQ pair) are deliberately dormant
lanes that activate on demand.

| File (under `workflows/`) | Live name | Phase | Nodes | Active |
|---|---|---|---|---|
| [lead-intake/form-receiver.json](workflows/lead-intake/form-receiver.json) | [PROD] lead-intake / form-receiver | PROD | 13 | yes |
| [sarah/pipedrive-lead-auto-caller.json](workflows/sarah/pipedrive-lead-auto-caller.json) | [DEV] sarah / pipedrive-lead-auto-caller | DEV | 7 | no |
| [sarah/outbound-caller-with-client-data.json](workflows/sarah/outbound-caller-with-client-data.json) | [DEV] sarah / outbound-caller-with-client-data | DEV | 13 | yes |
| [sarah/outbound-caller-bulletproof.json](workflows/sarah/outbound-caller-bulletproof.json) | [DEV] sarah / outbound-caller-bulletproof | DEV | 12 | yes |
| [sarah/email-tool.json](workflows/sarah/email-tool.json) | [DEV] sarah / email-tool | DEV | 10 | yes |
| [elevenlabs/post-call-webhook.json](workflows/elevenlabs/post-call-webhook.json) | elevenlabs_post_call_webhook | UNPHASED | 17 | yes |
| [elevenlabs/webhook-listener.json](workflows/elevenlabs/webhook-listener.json) | elevenlabs_webhook_listener | ALPHA | 35 | yes |
| [post-call/transcript-field-extractor.json](workflows/post-call/transcript-field-extractor.json) | [DEV] post-call / transcript-field-extractor / v2 | DEV | 10 | yes |
| [post-call/llm-extraction-engine.json](workflows/post-call/llm-extraction-engine.json) | [DEV] post-call / llm-extraction-engine | DEV | 9 | yes |
| [post-call/pipedrive-updater.json](workflows/post-call/pipedrive-updater.json) | [DEV] post-call / pipedrive-updater | DEV | 28 | no |
| [post-call/self-healing.json](workflows/post-call/self-healing.json) | [DEV] post-call / self-healing | DEV | 5 | no |
| [post-call/dlq-reprocess.json](workflows/post-call/dlq-reprocess.json) | [DEV] post-call / dlq-reprocess | DEV | 3 | no |
| [eval/sris-master-orchestrator.json](workflows/eval/sris-master-orchestrator.json) | [DEV] eval / sris-master-orchestrator | DEV | 11 | yes |
| [eval/sris-verification-loop.json](workflows/eval/sris-verification-loop.json) | [DEV] eval / sris-verification-loop | DEV | 10 | yes |
| [eval/voice-agent-tester.json](workflows/eval/voice-agent-tester.json) | [DEV] eval / voice-agent-tester | DEV | 18 | yes |
| [eval/testing-framework-data-table-api.json](workflows/eval/testing-framework-data-table-api.json) | [DEV] eval / testing-framework-data-table-api | DEV | 29 | yes |
| [cicd/elevenlabs-cicd.json](workflows/cicd/elevenlabs-cicd.json) | [PROD] elevenlabs-cicd | PROD | 12 | yes |
| [sms/sarah-tool.json](workflows/sms/sarah-tool.json) | [PROD] sms / sarah-tool | ALPHA | 20 | yes |
| [sms/universal-message-sender.json](workflows/sms/universal-message-sender.json) | [DEV] sms / universal-message-sender | DEV | 24 | yes |

19 exhibits, 286 nodes. The other 48 live workflows (dup corpses awaiting
cleanup, scratch lanes, infra utilities, archived versions) are inventoried
in [`workflows/registry.yaml`](workflows/registry.yaml) but not exhibited.

## Sanitization contract

An exhibit never contains: `credentials`, `pinData`, `webhookId`,
`staticData`, `meta.instanceId`, instance ids/versions/timestamps, or any
secret-shaped string (redacted to `<REDACTED:<class>>` markers). Enforced by
`npm run verify` in CI and the pre-commit gitleaks hook; produced by
`scripts/sanitize-workflow.js`.

## Refresh procedure

```bash
npm run export      # re-fetch + re-sanitize every exhibit
npm run registry    # refresh fleet inventory + governance ledger
npm run drift       # confirm: exits 0 when repo == instance
```
