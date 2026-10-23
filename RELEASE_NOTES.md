# AFI v0.1.1

First public source release of AI Frontier Intelligence — a local-first research workspace that
keeps every AI-ecosystem claim tied to a source, a fetch date and an evidence level.

**Included**

- Evidence-backed project exploration, concept cards and side-by-side comparison.
- Build / Buy / Integrate decisions with explicit requirement coverage and evidence gaps.
- Radar: 7 / 30 / 90-day events plus real GitHub star observations.
- Local accounts, technical profiles and per-user relevance.
- Embedded PGlite out of the box; standard PostgreSQL when `DATABASE_URL` is set.
- Exact pinned dependencies (`package-lock.json`), MIT license, third-party attribution,
  a per-dependency license review, and the full test suite.

**Not included**

- Original private development history, runtime bundles, databases, backups or environment files.
- Any API key, token or credential. No model access is required to use the product.

**Known limits**

- Local Internal MVP, not a production SaaS. No email verification, password reset, OAuth, billing
  or data export.
- Refresh is bounded and synchronous; there is no durable scheduler yet.
- No vector search. Retrieval is canonical-ID and bilingual-alias matching, deliberately.
- Compatibility claims for external runtimes are declared-bound, not certified by testing.
- License review is an engineering assessment, not legal advice.

Run `npm test`, `npm run build` and `npm run test:browser` to verify the state of *your* checkout —
no historical PASS record ships with this repository, because a stale result next to new source is
worse than no result.
