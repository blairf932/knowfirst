# Authentication and Privacy Data Lifecycle — v0.1.1

Local foundation: PASS for tested authentication, isolation and deletion paths. Public deployment readiness: PARTIAL until the operational conditions below are met. This is an engineering review, not a legal compliance certification.

## Authentication

New passwords use random 16-byte salts and scrypt N=131072, r=8, p=1, 64-byte output, versioned as scrypt-v2. Comparisons use timingSafeEqual. Legacy v0.1 hashes remain readable and upgrade after successful login. Minimum password length is 12, maximum 128. API limits apply before expensive hashing.

Sessions use 32 random bytes, store only a SHA-256 digest, expire after 7 days and are removed on logout. Cookies are HttpOnly/SameSite=Lax and Secure when APP_ORIGIN is HTTPS. API authentication reads the current NextRequest cookie directly, avoiding ambient request-context ambiguity in a standalone bundle. Independent A/B profiles, spoofed identifiers, logout and deletion revocation are exercised in Edge/API tests.

Mutations require exact configured Origin. JSON bodies are bounded while streaming (16,000 bytes), validated with Zod and sent through SQL parameters. Limits are persisted and atomically incremented, including global anonymous/auth limits and per-user reauthentication/model limits. Proxy-provided IP headers are not trusted. These controls are not a public Internet load/abuse capacity test.

## Open registration and public exposure

The app binds to `127.0.0.1` by default, so only your own machine can reach it. In that mode, open registration is harmless: the only person who can sign up is you.

"Open registration" means `POST /api/auth/register` accepts any account with no invitation, no email verification, no admin approval. That is deliberate — the intended use is one user on one machine.

"Public exposure" means putting the app where the internet can reach it: a public server, `0.0.0.0`, or a reverse proxy. If you do that while registration is still open, any stranger can create an account, and if you have configured a paid model, those strangers can spend your API budget.

The rule is one line: **leave registration open while it is loopback-only; before exposing it, disable the register route or put an invitation / allowlist / approval step in front of it.**

Until you actually deploy it publicly, none of this needs doing.

## Personal data

| Data | Storage / retention | Deletion behavior |
|---|---|---|
| Email and password hash | users; until deletion | Deleted; new account gets a new random identity |
| Session digests | sessions; 7 days | All revoked by account deletion; never restored from backup |
| Technical context | user_contexts | Per authenticated user; explicit clear and account deletion |
| Search queries | research_runs; 30 days | Explicit clear, account cascade, scheduled retention |
| Model prompts | Transient process/request only | Not stored in usage or logs; remote provider receives explicit submitted query and public evidence |
| Model result cache | User-scoped llm_cache; 1 hour | Clear/account cascade; never restored |
| Shared evidence cache | card_cache | No personal context included; expired entries removed; never restored |
| Model ledger | Tokens/cost/model/task/status/request/card IDs; 90 days | Account-linked rows cascade; no prompts, keys or raw provider errors |
| Audit log | Action and bounded metadata; 30 days | Account-linked rows deleted; no query/profile/password logging |
| Erasure journal | Hashed random user ID and action/time | Independently retained to prevent resurrection from old backups; pseudonymous, not anonymous |
| Aggregate budget reservations | UTC-day global/user buckets | Global spend retained without personal content; user buckets removed on account deletion |

Settings exposes reauthenticated clearing and account deletion. API equivalents: POST `/api/privacy/clear` and `/api/auth/delete`, authenticated cookie + same Origin + current password. Account deletion also requires an explicit confirmation in the UI. A user-supplied userId is never the target selector.

Before deletion, a journal entry is appended and fsynced outside the backup. Only then is SQL deletion committed. Restore refuses a missing/corrupt journal and applies the latest known tombstones before completing. Personal-data clear events carry a cutoff timestamp so an old restore also removes pre-clear queries/contexts while retaining newer data. Database tombstones alone cannot protect against an older backup; the independent journal is essential.

The retention sweep runs with the durable scheduler. If the scheduler is disabled or the application is down, retention is delayed until its next successful run. Process-crashed LLM requests retain budget reservations conservatively. Account deletion cannot retract a request already sent to an external model provider; provider retention/deletion terms require operator review before public use.

## Backup operations

The tested local backup contains sensitive user data and is JSON, not encrypted by the application. File mode 0600 is requested, but this does not prove Windows ACL enforcement. Do not ship backups, `.data`, `.cache` or environment files. Package generation excludes these and scans artifact contents for configured model/GitHub secrets.

Before public beta: configure restricted service-account filesystem ACLs, encrypt off-device backups, set a documented maximum backup retention (proposed 30 days), protect and independently retain the latest erasure journal, and perform a restore using that latest journal. Windows ACL and off-device encryption deployment checks are NOT_TESTED. No claim of immediate physical deletion from historical backup media is made.

## Future account flows

Email verification: store hashed random one-use tokens, expiry, resend rate limits and an outbox; prevent account enumeration. Password reset: generic response, short-lived hashed token, reauthentication completion revokes all sessions and audits only the action. OAuth: authorization-code flow with PKCE/state/nonce, server-side verified issuer/audience, explicit account linking with reauthentication; never merge accounts solely by an unverified email. No paid email or OAuth provider is required or integrated in this phase.

Public beta requires HTTPS with correctly configured APP_ORIGIN, protected operator credentials/storage, explicit notice for external LLM processing and a recovery/support policy for accounts without automated email reset. Email verification/reset/OAuth implementation remains NOT_TESTED and is not represented as available.
