# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

---

# AFI project rules

Guidance for AI coding agents working in this repository. Humans should read
[CONTRIBUTING.md](CONTRIBUTING.md).

## Evidence discipline

- Preserve evidence provenance and temporal history. Unknown external data is `NULL` / `UNAVAILABLE`,
  never a fabricated zero or a claim about the present.
- Separate `FACT` from `ANALYSIS`. Source reachability, documentation declarations and tested
  compatibility are three different evidence levels and must stay labelled as such.
- A failed fetch keeps the previous fact with its timestamp and records `ERROR` / `RATE_LIMITED`.
  Never overwrite history to make a page look complete.

## Architecture boundaries

- Source protocols live in `lib/adapters/*` only. One module per protocol, fixed allowlist, bounded
  fetch, per-hop redirect validation.
- LLM vendors sit behind `LLMProvider`. No vendor SDK or response shape leaks past that boundary.
- No new database, queue or service without an ADR in `docs/ADR/` demonstrating the need.
- `lib/intelligence.ts` stays pure. I/O belongs in adapters, ingestion or the route layer.

## Safety and hygiene

- `.data`, `.env`, backups and caches never enter Git. `.gitignore` is not advisory.
- Stop the app before offline PGlite commands. Never remove an active database lock to force access.
- All SQL is parameterised; all external JSON is Zod-validated before it reaches the database.
- Exact dependency versions and a license inventory are required. An unresolved restricted license
  blocks commercial release, not internal inspection.
- Secrets never reach client bundles and are never logged.

## Verification

- Validate changes with the relevant unit, integration and API tests. Do not mark an item as passing
  when it was skipped, mocked or simulated — label simulated results as `SIMULATED`.
- If a required check cannot run in the current environment (missing service, no privilege, blocked
  network), say so explicitly and leave the item unresolved rather than downgrading the assertion.
