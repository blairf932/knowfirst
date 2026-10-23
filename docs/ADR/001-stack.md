# ADR 001 — Stable Next.js modular monolith, PostgreSQL domain

Date: 2026-09-04. Status: accepted for internal local MVP; commercial deployment gates remain open.

## Decision

Next.js 16.3.4 + React 19.2.8 + TypeScript 7.0.2, exact pinned versions verified through npm's official latest stable metadata. Node.js 24.19.0 was available. No beta/RC versions were selected. [Next.js release/security history](https://nextjs.org/blog) was checked as an additional official source.

| Criterion | Next.js monolith | FastAPI + separate React frontend |
|---|---|---|
| Development efficiency | One language, shared types and validation | Two runtimes and separate contracts |
| SEO / rendering | Server-rendered routes available directly | Requires additional rendering architecture |
| API | Route handlers sufficient at this scale | Strong API workflow but adds deployment unit |
| AI pipeline | Node workers and provider interface adequate for metadata stage | Better fit if later Python-specific ML becomes dominant |
| Background jobs | Same modules callable through CLI; durable worker can follow | Also viable, does not itself solve scheduling |
| Commercial deployment | Standard Node server and PostgreSQL | Viable but more operational surfaces |
| Windows | Node available; PGlite removes local DB setup prerequisite | Python available but separate frontend still required |

No independent evidence requires Redis, graph DB, microservices or vectors. A graph in PostgreSQL supports the present access patterns.

## Database

PGlite is [an embeddable PostgreSQL engine](https://pglite.dev/) and supports [Node filesystem persistence](https://pglite.dev/docs/filesystems). This machine had no PostgreSQL server or Docker. Use PGlite for one-process local work, standard `pg` driver for the same SQL model when DATABASE_URL is supplied. PGlite is not represented as a managed production PostgreSQL service. The standard driver path requires a separate acceptance run before deployment.

## Existing solutions considered

- Use Next/React for routing/rendering rather than creating a framework.
- Use PostgreSQL/PGlite and pg rather than a JSON file pretending to be a database.
- Use Zod rather than ad-hoc payload validation.
- Use fast-xml-parser rather than custom Atom parsing.
- Use Playwright/Edge for actual browser tests.
- Use Node's standard scrypt/crypto primitives for bounded local account sessions. Managed identity or established identity providers remain preferable for a public product; no claim is made that the small local account module is a complete commercial identity platform.
- Graphiti/Mem0/Supermemory are research subjects, not installed core dependencies. Introducing their operational databases and licensing into the intelligence product is not justified by present requirements.

Sites was reviewed but its hosted Worker runtime does not fit the requested persistent local PostgreSQL execution model. We did not replace PostgreSQL with D1 or use an experimental framework solely to satisfy a hosting template. This phase delivers the requested Windows-local Internal MVP; hosting selection awaits the production database and security gates.

## Consequences

Simple local setup and evidence traceability; no external paid services needed. PGlite single process and incomplete production identity are explicit limits. Optional Next image dependencies bring LGPL review items, detected by the lockfile-wide audit and not treated as automatically cleared.
