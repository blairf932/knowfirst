# Data model and temporal semantics

Entities: Concept, Tool, Company, Project, Technology. Company records currently identify GitHub organizations, not verified legal companies. Sources, Facts, Relationships, Events, Signals and UserContext are first-class tables.

| Table | Key properties |
|---|---|
| entities | stable id, unique slug, kind, aliases, editorial summary/details |
| sources | canonical URL, tier, adapter, entity, latest health and retrieval metadata |
| source_observations | append-only source health, retrieval time, metadata hash and payload |
| facts | subject, predicate, JSON value, source FK, FACT/ANALYSIS, confidence, all temporal fields |
| fact_verifications | each successful re-verification of the same fact |
| relationships | typed directed edge, evidence kind, optional source and temporal validity |
| events | release/paper/discussion/observed change, publication and discovery dates |
| signals | numerical observation with source, unit, status, observation time |
| users / sessions / user_contexts | password hash, hashed session tokens, user-isolated profile |
| research_runs / card_cache | research trace and shared evidence-only cache |
| llm_usage | per user/run/provider/model/task token and estimated cost ledger |
| audit_log / rate_limits / job_locks | operations trace, bounded access and refresh exclusion |

Facts are versioned by `(entity_id, predicate, source_id)`. A partial unique index permits one open validity interval. A changed value closes the prior interval and inserts a new fact in one transaction. Equal values only extend verification history. A failed request never erases an old fact. A missing README phrase retires the previous **mention claim**, not the underlying feature.

`valid_from` defaults to the time a claim was observed, not an invented historical start date. `published_at` remains NULL when unknown. `discovered_at` represents when the system learned it. Historical queries require `valid_from <= at`, `valid_until > at OR NULL`, and `discovered_at <= at`; source health and last verification are also reconstructed from their append-only histories.

There is no claim that a current repo observation was true in March 2026. Before the first observation the answer is UNAVAILABLE. Historical pages clearly label present-day editorial concept explanations separately. Retrospective domain-validity inference and full bitemporal corrections are future work.

Source records are URL-deduplicated. Concepts may share a reference URL; the editorial catalog retains the reference on each concept even when there is one canonical source row. UI derives related tool sources from typed category edges.

User context, sessions and research history queries use the authenticated session ID, never a request-provided user ID. RLS is not yet enabled; production needs a reviewed least-privilege database role and RLS or equivalent independent enforcement before multi-tenant internet use.

Official plugin declarations create temporal DOCUMENTS_INTEGRATION_WITH edges with a source ID. These describe the documented integration, not successful execution in a specific user environment.
