# AGENTS.md — n8n_showcase project

> Project-specific guidelines for any AI agent (Claude Code, Codex CLI, Gemini CLI) operating in this repo. Universal rules live in `~/.claude/CLAUDE.md`; this file only covers n8n-specific judgment.

## Tool invocation discipline

When calling MCP tools (especially `mcp__n8n-mcp__*`), the parameter names matter exactly. Common confusions: `values` vs `elements`, `nodes` vs `operations`, partial-update payloads vs full-update payloads. Before invoking a tool you've not used in the current session, look up its schema (n8n MCP tools have machine-readable schemas) — guessing param names is the most common cause of silent failures or 400 errors. If a tool errors with "unknown property", treat it as a typo, not as needing a workaround.

## Authoring n8n workflows

### Pre-deploy checklist
Before calling `n8n_create_workflow` or `n8n_update_*`: (1) the workflow has a non-empty `name` for create operations, (2) the `nodes` array is non-empty for full creates/updates (partial updates may legitimately omit it), (3) the n8n instance is reachable, (4) `n8n_validate_workflow` or `n8n_validate_node` was called against the payload first. Skipping validation is the most common cause of runtime failures that only surface on activation.

### n8n MCP over browser automation
For anything involving `n8n.wranngle.com`, use `mcp__n8n-mcp__*` tools — never browser automation. The MCP surface covers create / update / get / list / delete / validate / autofix / deploy_template; if you're tempted to drive the n8n UI in a browser, the API tool already exists. Browser automation against n8n is treated as a hard error.

### IF node bug — prefer Switch
The n8n IF node v2.2 has documented routing bugs (GitHub issues #12237, #11877, #21334) where it can route ALL data to the TRUE branch regardless of condition. Use the Switch node for any conditional routing in new workflows. If you must touch an existing IF node, monitor execution traces in production for misrouted items.

### Prefer n8n Data Tables over Google Sheets
When a workflow needs tabular state, default to n8n Data Tables, not Google Sheets. Sheets adds OAuth complexity, rate limits, and external-dependency failure modes; Data Tables are native, no auth, co-located with the workflow. Only choose Sheets when an external human stakeholder genuinely needs spreadsheet access to the same data.

## Credentials and secrets

Never hardcode API keys in workflow JSON, Code-node `jsCode`, or scripts under this repo. Watch especially for these patterns: `sk_[a-f0-9]{40,}` (ElevenLabs), `sk-[a-zA-Z0-9]{40,}` (OpenAI), `AC[a-f0-9]{32}` (Twilio Account SID), and any quoted 32+-char hex string. Credentials live in `~/.claude/.env` (loaded into n8n via the standard env-loader pattern) or in n8n's own credential store. If you find a key in source, treat it as a leaked secret: rotate, then move to env.

## LLM nodes in n8n

Never call LLM APIs from an HTTP Request node or from `jsCode` inside a Code node. Blocked endpoints include `openrouter.ai`, `api.openai.com/v1/chat`, `generativelanguage.googleapis.com`, `api.anthropic.com`, `api.cohere.ai`, `api.mistral.ai`, `api.together.xyz`, `api.groq.com`. Use the LangChain node family instead: `@n8n/n8n-nodes-langchain.lmChatGoogleGemini`, `lmChatOpenAi`, `lmChatAnthropic`, `lmChatOllama`, `lmChatMistralCloud`, `agent`, `chainLlm`, `toolAgent`. These provide credential management, observability, and consistent error handling.

Model selection in LangChain LLM nodes is governed by the project's model rankings. Banned/deprecated models (e.g. `gpt-4o-mini`, `gemini-2.0-flash-001`, `gemini-1.5-flash`, `claude-3-haiku`, `gpt-5-mini`) must be replaced before deploy. Defaults: text/general workflows use `gemini-3-pro`; code-heavy workflows use `claude-opus-4-5`. Get node config via `mcp__n8n-mcp__get_node_essentials({ nodeType: "nodes-langchain.lmChatGoogleGemini" })`.

## n8n API auth — /api/v1 vs /rest

The n8n public API key (`X-N8N-API-KEY`) authenticates `/api/v1/*` only. It does NOT authenticate `/rest/*` endpoints — those need session-cookie auth via `POST /rest/login` with `{ emailOrLdapLoginId, password }`, returning an `n8n-auth` cookie. Everything in this repo (export, drift, registry, install) uses `/api/v1` exclusively; reach for `/rest/*` only for operations the public API lacks (Data Table admin, activation with versionId), and note there is currently no session helper on disk — an earlier doctrine revision referenced `~/.claude/utils/n8n-session.ts`, which does not exist.

Two recurring gotchas:
- **Data Table node config**: the `n8n-nodes-base.dataTable` node requires `{ resource: "row", operation: "get|insert|update|deleteRows", dataTableId: { mode: "name", value: "<table-name>" }, returnAll: true }`. Common mistakes: missing `resource: "row"` (causes "Could not find property option" on activate), wrapping `dataTableId` in `__rl` (not needed), trying to pass `filters` on `get` (not a valid property — use `returnAll` + client-side filter).
- **Workflow activation**: `POST /rest/workflows/{id}/activate` requires the **current** `versionId` in the body. A stale `versionId` returns HTTP 200 but leaves `active: false` (silent failure). Always GET the workflow first to grab the current `versionId`, then activate.

## Workflow governance — DEV-only modification, no deletion

This project uses a two-real-phase model: **DEV** (modifiable) and **ARCHIVED** (read-only). The legacy phases ALPHA / BETA / GA / PROD exist in tooling but are not in active use — treat any non-DEV phase as protected.

Rules:
- **Deletion is forbidden.** To retire a workflow, rename with `[ARCHIVED]` prefix, deactivate it, and update `workflows/governance.yaml` with `phase: ARCHIVED`. Preserves audit trail.
- **Only `[DEV]` workflows may be modified.** Phase is determined tags-first (n8n tags `dev` / `alpha` / `beta` / `prod` / `archived`), then name-prefix fallback (`[DEV] Verb Noun`), then default to DEV. Modifying a non-DEV workflow requires explicit user approval — clone to a fresh DEV workflow instead.
- **New workflows auto-tag as DEV.** Untagged workflows (no n8n tag and no `[PHASE]` prefix) are grounds for archival review.
- **Before creating, check for similar.** A 70%+ name-similarity match against the existing registry should trigger a clone-or-replace conversation, not a duplicate workflow. 40-70% similarity warrants an explicit "yes I really need a new one" from the user.

Governance state lives in `workflows/governance.yaml` and `workflows/registry.yaml` — both are GENERATED from the live instance by `npm run registry`; edit the generator, not the files. Known live-fleet drift (dual-active versions, unphased names, version suffixes) is listed in governance.yaml's `known_drift` section.

## Exhibit pipeline (how workflow JSON enters this repo)

Workflow JSON is never hand-authored or hand-edited here. The only path in is `npm run export` → `scripts/sanitize-workflow.js` (strips instance state, redacts secret-shaped strings, prints a receipt). `npm run drift` proves every exhibit equals the sanitized live workflow byte-for-byte; a scheduled CI job runs it daily. To change an exhibited workflow: change it on the instance (respecting the DEV-only rule), then re-export.

## n8n node levels (hierarchical sequential development)

For test/verification planning, n8n nodes map to three levels:
- **Level 3 — Node/Component**: leaf nodes (httpRequest, code, set, if, switch, merge, splitInBatches, dateTime, all integration nodes — Slack, HubSpot, Postgres, S3, etc., all `@n8n/n8n-nodes-langchain.*`). Test in isolation with mocked credentials and sample input.
- **Level 5 — Subworkflow execution**: `executeWorkflow`, `executeWorkflowTrigger`, `errorTrigger`, `start`. Test as integration contracts between caller and callee.
- **Level 6 — Orchestration / triggers**: `webhook`, `manualTrigger`, `scheduleTrigger`, `emailTrigger`, `formTrigger`, `chatTrigger`, `sseWrite`, `workflowTrigger`. Test end-to-end with simulated trigger events.

Verification states ladder: `UNTESTED → RUNTIME → MOCKED → INTEGRATED → VERIFIED`. A workflow's governance phase implies a minimum verification state (DEV→UNTESTED, ALPHA→RUNTIME, BETA→MOCKED, PROD→INTEGRATED, GA/ARCHIVED→VERIFIED) — promotions advance the verification state but never regress it.
## Naming standards (n8n)

- **Workflows**: `[PHASE] domain / purpose` — lowercase slash-path after the phase prefix, matching the May 2026 fleet-wide rename. ✅ `[DEV] post-call / llm-extraction-engine` / `[PROD] lead-intake / form-receiver`. ❌ version suffixes (`/ v2`), snake_case roots (`elevenlabs_post_call_webhook`), phase-less names. The live fleet still carries violations of this standard; they are inventoried in governance.yaml `known_drift` — do not add new ones.
- **Nodes**: `Category: Action Description` in Title Case with colon separator. ✅ `Auth: Check Origin` / `Email: Send Via SMTP` / `Extract: Parse Parameters`. ❌ `check-auth` / `send_email` / `ExtractParams`.
- **Webhook paths and IDs**: kebab-case `entity-verb-noun`, no version suffixes, no `tool` / `workflow` / `v1` suffixes. ✅ `sarah-send-email`, `lead-process-intake`. ❌ `sarah-send-sms-v3`, `send_email`, `sendEmail`.
- **Files in this repo**: kebab-case `entity-purpose.{ext}`. ✅ `lead-processor.ts`. ❌ `sarah_email_tool_v1.json`.

Exceptions: `old/`, `archive/`, `test-data/`, `fixtures/` paths and `backup_*` / `export_*` / `archived_*` prefixes are exempt.

## Test discipline

One test file: `tests/n8n_showcase.bats` (doctrine: one suite per project, grouped by comment headers). When you modify anything under `scripts/`, `lib/`, or `bin/`, run `npm test` plus the four exhibit gates (`npm run verify && npm run governance && npm run lint:ratchet && npm run check:code-nodes`) before declaring done.

### Test completion summary
Whenever you run a test suite end-to-end, finish with a structured summary so the next agent can pick up cold:
```
## TASK COMPLETE
- Tests run: 610
- Passed: 608
- Failed: 2
- Skipped: 0
- Notable: [any failures or follow-ups]
```
A bare "tests passed" line without counts is insufficient — it can't be diffed against the previous run.

