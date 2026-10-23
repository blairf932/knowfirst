# Commercial risks and release gates

Internal MVP acceptance is not authorization for commercial deployment.

| Priority | Risk | Present control | Required before public paid release |
|---|---|---|---|
| 1 | Incomplete evidence leads to incorrect buy/build decisions | Explicit UNKNOWN/WAIT, sourced facts, ANALYSIS labels, conservative compatibility handling | Task-based integration tests, reviewed feature matrix, pricing/license/maintenance validation |
| 2 | Accounts and tenant privacy | scrypt passwords, opaque hashed sessions, httpOnly SameSite cookies, same-origin mutation checks, explicit user-scoped SQL, isolation tests | External security review, MFA/recovery/email verification, deletion/export lifecycle, TLS, RLS/least privilege, consent and privacy policy |
| 3 | Dependency and source license obligations | Full exact-version inventory; LGPL and CC-BY flagged; researched product code not embedded | Resolve image-pipeline LGPL distribution strategy and attribution, provider ToS review, commercial source reuse review |
| 4 | Reliability and loss of accumulated history | Transactions, migration ledger, append-only observations, local backup/restore guard, disk persistence test | Standard PostgreSQL integration/load/failover tests, encrypted scheduled backups, PITR, recovery objectives and restore drills |
| 5 | Freshness, cost and source availability | State semantics, bounded allowlisted fetch, rate limiting, evidence caching, optional-model design | Durable scheduler, per-source TTL/quotas, model adapters with cost budgets, monitoring, incident response and source health alerts |

Additional limitations: no billing/subscription, no data-export UI, no automatic scheduled collection, no trusted proxy configuration, no comprehensive source-terms/robots automation. Registration is intended for a loopback-only local environment. Production must explicitly disable open registration or replace it with reviewed invitation/identity controls.

Local default bind is 127.0.0.1:3100. APP_ORIGIN must be configured exactly. No secret is placed in client bundles; no fixed default password. JSON backups contain sensitive user data and must not be publicly accessible.
