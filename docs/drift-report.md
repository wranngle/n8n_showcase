# Drift report — exhibits vs live instance

- Instance: https://n8n.wranngle.com
- Generated: 2026-07-23T05:32:55.318Z
- Exhibits checked: 19
- In sync: 19
- Drifted or missing: 0

## Fleet summary

67 workflows on the instance, 33 active. Exhibits cover 19 of them; the rest are visible in workflows/registry.yaml.

| Phase | Count |
|---|---|
| ALPHA | 2 |
| ARCHIVED | 12 |
| DEV | 45 |
| PROD | 2 |
| UNPHASED | 3 |
| UTIL | 3 |

## Per-exhibit status

| Exhibit | Live name | Status |
|---|---|---|
| workflows/lead-intake/form-receiver.json | [PROD] lead-intake / form-receiver | in-sync |
| workflows/sarah/pipedrive-lead-auto-caller.json | [DEV] sarah / pipedrive-lead-auto-caller | in-sync |
| workflows/sarah/outbound-caller-with-client-data.json | [DEV] sarah / outbound-caller-with-client-data | in-sync |
| workflows/sarah/outbound-caller-bulletproof.json | [DEV] sarah / outbound-caller-bulletproof | in-sync |
| workflows/sarah/email-tool.json | [DEV] sarah / email-tool | in-sync |
| workflows/elevenlabs/post-call-webhook.json | elevenlabs_post_call_webhook | in-sync |
| workflows/elevenlabs/webhook-listener.json | elevenlabs_webhook_listener | in-sync |
| workflows/post-call/transcript-field-extractor.json | [DEV] post-call / transcript-field-extractor / v2 | in-sync |
| workflows/post-call/llm-extraction-engine.json | [DEV] post-call / llm-extraction-engine | in-sync |
| workflows/post-call/pipedrive-updater.json | [DEV] post-call / pipedrive-updater | in-sync |
| workflows/post-call/self-healing.json | [DEV] post-call / self-healing | in-sync |
| workflows/post-call/dlq-reprocess.json | [DEV] post-call / dlq-reprocess | in-sync |
| workflows/eval/sris-master-orchestrator.json | [DEV] eval / sris-master-orchestrator | in-sync |
| workflows/eval/sris-verification-loop.json | [DEV] eval / sris-verification-loop | in-sync |
| workflows/eval/voice-agent-tester.json | [DEV] eval / voice-agent-tester | in-sync |
| workflows/eval/testing-framework-data-table-api.json | [DEV] eval / testing-framework-data-table-api | in-sync |
| workflows/cicd/elevenlabs-cicd.json | [PROD] elevenlabs-cicd | in-sync |
| workflows/sms/sarah-tool.json | [PROD] sms / sarah-tool | in-sync |
| workflows/sms/universal-message-sender.json | [DEV] sms / universal-message-sender | in-sync |
