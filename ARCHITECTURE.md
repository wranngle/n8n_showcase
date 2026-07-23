# Architecture

This repo publishes sanitized exhibits of a live n8n fleet (n8n.wranngle.com,
67 workflows / 33 active) and the toolchain that keeps the exhibits equal to
the instance. The system being exhibited is a voice-AI sales operation:
an ElevenLabs agent ("Sarah") that calls leads, a post-call pipeline that
turns transcripts into CRM data, and an eval harness that regression-tests
the agent.

## The production system (what the exhibits are exports of)

```
 Pipedrive event / website form
        │
        ▼
 lead-intake/form-receiver ──────────► email + RCS notification
        │
        ▼
 sarah/pipedrive-lead-auto-caller ──► sarah/outbound-caller-with-client-data
        │                                        │
        │                              ElevenLabs voice session
        │                              (sarah/email-tool and sms/sarah-tool
        │                               are tools Sarah invokes mid-call)
        ▼                                        │
 elevenlabs/post-call-webhook  ◄─────────────────┘
 (HMAC-verified)  │
                  ▼
 elevenlabs/webhook-listener ─► post-call/transcript-field-extractor
                                          │            │ on failure
                                          ▼            ▼
                       post-call/pipedrive-updater   post-call/self-healing
                                                     post-call/dlq-reprocess

 Control loops, off the hot path:
   eval/sris-*  — scenario suites graded against the live agent
   cicd/elevenlabs-cicd — agent config deploys through a pipeline
```

## Repo surface

```
n8n_showcase/
├── workflows/
│   ├── exhibits.yaml           # manifest: live id -> file -> story chapter
│   ├── lead-intake/ sarah/ elevenlabs/ post-call/ eval/ cicd/ sms/
│   │                           # 19 sanitized exports, 286 nodes
│   ├── registry.yaml           # GENERATED fleet inventory (all 67)
│   └── governance.yaml         # GENERATED phase ledger + known live drift
├── bin/
│   ├── drift.js                # exhibit-vs-instance byte comparison
│   └── n8n-lint.js             # 4 ops rules + ratchet baseline
├── lib/
│   ├── drift/                  # /api/v1 client, drift engine
│   └── lint/                   # rule registry + rules
├── scripts/
│   ├── sanitize-workflow.js    # the publish gate (strip + redact + receipt)
│   ├── export-live-workflows.js
│   ├── generate-registry.js
│   ├── governance-engine.js    # doctrine gate (errors block, drift warns)
│   ├── verify-workflows.js     # forbidden-key gate
│   ├── check-code-nodes.js     # compiles all Code-node JS
│   ├── install-workflow.js     # POST /api/v1/workflows
│   ├── n8n-diff.js + lib/diff/ # deterministic workflow diff
│   └── secure-n8n-webhooks.js, secure-internal-callers.js
├── tests/n8n_showcase.bats     # single suite, 21 behavior tests
├── fixtures/                   # sanitize / lint / diff fixtures
└── docs/                       # index, webhook auth, drift report, brand
```

## Data flow of this repo itself

1. `npm run export` — GET each manifest id from `/api/v1/workflows/:id`,
   sanitize, write. The sanitizer is the only path by which workflow JSON
   enters the repo.
2. `npm run registry` — regenerate the fleet inventory and governance ledger.
3. CI (`ci.yml`) — tests, verify, governance, lint ratchet, code-node
   compilation on every push/PR.
4. CI (`drift.yml`, daily) — re-fetch, re-sanitize, byte-compare; red when
   the instance moves and the repo doesn't.

## Workflow governance

- **DEV**: modifiable. **ARCHIVED**: read-only; deletion is forbidden —
  retire by renaming with the `[ARCHIVED]` prefix and deactivating.
- Phase is resolved tags-first, then name prefix; unphased legacy names are
  reported in `governance.yaml` under `known_drift`, not hidden.
- `workflows/governance.yaml` is generated from the instance;
  `scripts/governance-engine.js` gates the repo side.

## Boundaries

- The voice runtime is the ElevenLabs platform; agent configs deploy via the
  `elevenlabs-cicd` workflow, not from this repo.
- The eval harness's n8n side is exhibited here (`workflows/eval/`); deeper
  eval tooling lives in `wranngle/voice_ai_agent_evals`.
- Proposal/PDF generation lives in `wranngle/gtm_ops`.
- The operational source of truth for workflows is the n8n instance. This
  repo is the exhibit layer with a drift guarantee, never a second master.
