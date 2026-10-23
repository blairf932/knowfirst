# Real LLM integration and cost controls — v0.1.1

DeepSeek Flash is the first implemented provider behind LLMProvider. Other provider names remain reserved. Four explicit authenticated POST `/api/llm` tasks are available: classification, extraction, research (Card explanation), build-analysis. Body: task, query, optional cardId. User Context is not automatically sent. Ordinary navigation, Compare and deterministic Build or Buy continue to work without any model.

This phase's real integration is an opt-in API service. The main browsing/search/card UI is still assembled deterministically; it does not automatically call a model on each navigation. There is no autonomous open-web LLM research agent. Structured extraction proposes claims copied from bounded existing evidence, verifies predicate/value against that evidence, and does not insert model output as a verified Fact. Open-ended extraction from arbitrary page bodies is not implemented.

The prompt contains at most four short verified facts, their IDs and source references. Untrusted query/source text is treated as data. Output must be JSON with ANALYSIS kind, bounded text and valid evidence references. Classification requires exactly one intent. Extraction requires a `claims` array containing exactly one structured claim; zero or multiple claims fail schema validation, and an extraction with no eligible supporting evidence cannot pass. Other task types reject leaked `claims` or `intent` fields. Invalid citations, missing required fields and mismatching predicate/value pairs also fail validation. The persisted Fact store is never rewritten by the model.

An extraction may make at most two provider attempts. Only `OUTPUT_JSON_INVALID` and `OUTPUT_SCHEMA_INVALID` trigger the single repair attempt; provider, configuration, budget and transport failures are not retried as output repair. Both attempts share one request ID, while each attempt retains its own usage row, status, token counts and estimated cost. The response reports the attempt count, repair outcome and total estimated cost. If any charged attempt has unknown cost, the aggregate remains NULL rather than becoming zero. HTTP 200 or provider transport success is not a business PASS: acceptance also requires `status === SUCCESS`, exactly one grounded claim, a complete attempt ledger and matching aggregate cost.

Acceptance artifacts are generated locally and never shipped: `scripts/llm-acceptance.ts` writes a real-provider post-remediation record, and `scripts/llm-extraction-acceptance.ts` writes the focused extraction record. A stored PASS file sitting next to source code cannot describe a checkout it was not produced from, so this repository ships the scripts rather than their output — run them to produce evidence for your own environment. The Node test suite separately verifies valid, zero/multiple-claim invalid, repaired and unrecoverable paths with an injected provider; those failure-path checks are SIMULATED and are not mislabeled as real provider failures.

## Cost ledger

Each request records provider/model/task, request and card IDs, user, input/output tokens, latency, estimated USD cost, status, error code, cache flag and price basis. POST is authenticated and rate limited. GET `/api/usage` returns only that authenticated user's request, card, UTC day, model and task aggregates, including counts of unknown costs.

Global/day and user/day budget rows are locked before reservation. Default global budget: $0.10/day; user: $0.03/day; the example application call cap is 10/day. Warning begins at 80%. A maximum input-byte bound and 1024 output-token cap constrain reservations. Unknown billing consumes a conservative reservation, never a fabricated zero. Crashed RUNNING requests remain reserved for their budget day. Cache keys include user/provider/model/task/prompt/schema version; results expire after one hour. Cache hits cause no external call and record actual zero incremental API spend. Acceptance runs may raise the call cap explicitly through the environment; such an override is recorded in the run's own evidence rather than assumed. Extraction remains limited to two attempts regardless.

Task model overrides exist but unpriced routes are rejected. Only the reviewed configured deepseek-v4-flash route is enabled in this phase. No automatic fallback to an expensive model exists. Provider outages or budget blocks return status without removing browsable data. The four-task fixture demonstrates real network calls; outage, invalid JSON/schema and tight-budget tests use an injected provider and are not mislabeled real provider outages.

Official references checked 2026-09-05: https://api-docs.deepseek.com/quick_start/pricing/ ; https://api-docs.deepseek.com/guides/thinking_mode/ ; https://api-docs.deepseek.com/guides/json_mode/ . The configured alias resolves per the provider's current version policy. Ledger estimates deliberately use the peak upper rates: $0.44/M uncached input, $0.014/M cached input and $1.32/M output; off-peak discounts are not assumed. These are dated engineering estimates, not provider invoices. Recheck prices and model routing before any public release.

| Post-remediation successful call | Input / output tokens | Peak estimate USD |
|---|---:|---:|
| Intent | 513 / 68 | 0.000151896 |
| Focused structured extraction | 560 / 151 | 0.000445720 |
| Full-fixture structured extraction | 560 / 125 | 0.000247816 |
| One Card explanation | 495 / 88 | 0.000170376 |
| Build analysis | 495 / 87 | 0.000169056 |

The cached Card explanation cost is $0 incremental API spend. These samples are single-call peak-rate estimates, not a latency or cost SLA, and not a population average. The ordinary evidence-only Card path has no external model call.
