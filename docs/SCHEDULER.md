# Persistent Research Scheduler — v0.1.1

Status: PASS for the tested single-monolith foundation. No queue service or microservice was added.

`research_jobs` persists source, freshness policy, attempts, due time, status, owner and lease. States: PENDING, RUNNING, SUCCESS, PARTIAL, FAILED, RATE_LIMITED. A partial unique index permits at most one active job per source. Native workers claim due rows with FOR UPDATE SKIP LOCKED, commit ownership, then hold the job and source row locks throughout bounded network collection and persistence. Ownership is rechecked before fetch; an expired lease cannot steal a still-locked active fetch. Source writes are serialized independently of the former global ownerless lock.

Transient errors and rate limits schedule bounded exponential backoff. Maximum attempts per job is 3; retry delay is 60 × 2^attempts seconds capped at 3600. While a retry is scheduled the job is PENDING and its previous result is retained as error_code and in the source observation. At exhaustion FAILED/RATE_LIMITED is terminal. A later freshness cycle is a new job, subject to policy spacing. Crash recovery requeues expired unlocked jobs, preserving attempts; exhausted jobs fail. No unbounded retry loop is used.

| Policy | Hours | Current assignment |
|---|---:|---|
| Evergreen Concept | 2160 | Document sources |
| Tool Status | 168 | README, integration docs, package metadata |
| Pricing | 24 | Policy available; no pricing connector added |
| Release | 6 | GitHub releases |
| Recent Events | 6 | HN/arXiv metadata |
| Radar Signals | 6 | GitHub status + metrics |

Next instrumentation starts one local timer when SCHEDULER_ENABLED=true; every 15 seconds it schedules due sources, runs at most three jobs and performs privacy retention. Multiple instances coordinate using the same SQL queue. Tests prove duplicate-enqueue suppression, two workers/one fetch, lease recovery and attempt exhaustion. A committed PENDING job also survived an actual application process stop/start (`SCHEDULER_RESTART_RESULT.json`). The acceptance-only future job is then deliberately marked FAILED with ACCEPTANCE_CLEANUP, not mislabeled a successful collection.

RUNNING crash recovery is tested by database reconnect plus expired-lease simulation; forced mid-request process kill against an external source is NOT_TESTED. No source count was expanded. Existing source retrieval failures remain visible; browsing uses stored evidence.
