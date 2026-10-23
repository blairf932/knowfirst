# Standard PostgreSQL Acceptance — v0.1.1

Status: PASS. Executed 2026-09-05 on Windows x64, Node 24.19.0 and native PostgreSQL 17.11 (MSVC). No PGlite fallback was used in this acceptance.

## Environment and reproducibility

Official PostgreSQL Windows page links to EDB binaries: https://www.postgresql.org/download/windows/ and https://www.enterprisedb.com/download-postgresql-binaries . The observed 17.11 Windows x64 archive link was https://sbp.enterprisedb.com/getfile.jsp?fileid=1260491 . Download SHA-256: `4B8DB0930C38F6EF845DB919551DEDDA3B6B845AEB0927B3D79A6E8E9E4537CF` (locally calculated; not a separately verified vendor signature).

Binaries are in ignored `.cache/pg17`; cluster is in ignored `.data/postgres17`. It listens only on 127.0.0.1:55432, uses SCRAM authentication and a generated password. Application role `frontier_app` is not a superuser. Credentials stay in ignored local configuration and are never included in reports. No Windows service was installed. Existing v0.1 PGlite data remains separate.

`node scripts/pg-lab.mjs init` creates a fresh lab; existing configuration is never overwritten. Use `start`/`stop` afterward. `run <database> <node arguments>` supplies the database URL to a child without printing it. The release launcher requires standard PostgreSQL and fails closed if DATABASE_URL is absent.

## Required path

| Check | Result | Evidence |
|---|---|---|
| Clean native database, migrations 001–004, seed | PASS | Native server version; schema_migrations; 38 entities / 41 existing sources |
| Standalone application startup | PASS | Port 3101; `/api/health` reports PostgreSQL / 0.1.1 |
| Register A/B and save independent contexts | PASS | Browser API tests and checkpoint/relogin tests |
| Create/read sources, facts and events | PASS | Seed creates sources; real adapters create 56 facts, 56 claims and 151 events |
| Compare and Build or Buy | PASS | Real Edge journey, including tables, INTEGRATE as a recommendation to test and DECLARED plugin evidence |
| Application stop/start and native database stop/start | PASS | pg_ctl stop/start; application process replaced; evidence checksum unchanged |
| A/B persistence after restart | PASS | `PG_RESTART_RESULT.json`; structural JSON comparison, not key-order comparison |
| Consistent backup from live native PostgreSQL | PASS | REPEATABLE READ READ ONLY transaction; `backups/pg-v011-acceptance.json` (sensitive, ignored) |
| Restore into clean `frontier_restore_v011` | PASS | Empty-destination guard; installed schema versions checked; no overwrite |
| Restore integrity and session revocation | PASS | `PG_RESTORE_RESULT.json`; sessions not restored; latest erasure ledger applied |
| Critical path rerun on restored DB | PASS | All 8 Edge/API tests passed, including new deletion checks |

All five public data sets have the same SHA-256 before restart and after restore: `0d3b00bfc0ba7333010cc0da303ed4e7e7a1e422db41d8796d5d422116013643`. This is a deterministic checkpoint digest of entities, sources, facts, claims and events, not a backup-file checksum.

## Data access invariants

- PGlite and native PostgreSQL have matching public table columns, types, nullability, index names and tables, checked by the same test suite. Native tests run against dedicated databases and reject an unexpected destination name.
- Transactions roll back; nested transactions explicitly reject on both engines instead of accidentally committing through a different pooled connection.
- Native migrations use a transaction advisory lock. Concurrent cold-start stress across multiple app instances is NOT_TESTED; 20 concurrent fact writes are tested.
- Source row locks serialize temporal writes. The partial unique index prevents duplicate current facts. Claim references, confidence, predicates, values and Tier C restrictions are checked in SQL. Claims are append-only.
- Timestamp comparisons, historical validity and JSONB round trips pass. PostgreSQL JSONB can reorder object keys; the acceptance comparison uses structural equality.
- No vector extension is assumed or installed. Semantic vector search remains outside this version.
- The backup is an application logical backup, not a pg_dump archive. Native pg_dump/pg_restore archive format is NOT_TESTED. Application restore requires all installed migrations and a current independently retained erasure ledger.

`npm test`: 34/34. `npm run test:postgres`: 21/21 (the DB subset, not 21 additional unique tests). Before repeating the latter, `node scripts/pg-lab.mjs reset-tests` recreates only the three explicitly named disposable test databases. It does not reset the acceptance or restored application databases.
