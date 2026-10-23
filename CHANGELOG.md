# Changelog

All notable user-visible changes are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-10-22

First public source release.

### Added
- Frontier Cards with sourced facts, license status and declared-vs-tested capability levels.
- Side-by-side project comparison, with FACT and ANALYSIS labelled separately.
- Build / Buy / Integrate decision view driven by requirement coverage and evidence gaps.
- Radar with 7 / 30 / 90-day events and real GitHub star observations.
- Source status page exposing per-source fetch state, timestamps and failure reasons.
- Local accounts with `scrypt` passwords, hashed opaque sessions and per-user profiles.
- Optional model assistance behind a single `LLMProvider` boundary with daily budget and call caps.
- Embedded PGlite by default; standard PostgreSQL via `DATABASE_URL`.
- JSON backup and restore tooling that refuses to overwrite a non-empty database.
- Dependency license inventory and per-dependency disposition review.

### Notes
- Scope is 17 concepts and 7 projects. This is a curated Internal MVP, not a web-scale index.
- No email verification, password reset, OAuth, billing or data-export UI.
- Registration is intended for loopback-only use; disable it before any public exposure.
