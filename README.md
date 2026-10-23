# knowfirst

> Local-first research workspace for the AI ecosystem. Turns scattered signals into traceable, time-stamped evidence — so you know what the world has already built before you build it.
>
> **Know Before You Build. 动手之前，先知道世界已经做到哪一步。**

[中文说明见下文](#中文说明) · MIT License · Node.js 24+ · No Docker required

---

**Status: v0.1.1, alpha.** Internal MVP, not production-ready. Registration is open by default and the server binds to 127.0.0.1 only. Read [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md) before exposing it anywhere.

Previously developed under the internal name **AI Frontier Intelligence (AFI)**. The rename is branding only: the package name, database format identifiers and backup version strings are unchanged, so an existing local database keeps working.

## Why this exists

Most "AI tool directories" are lists. Most "AI answers" are confident and unverifiable.
knowfirst takes a third path: every claim is attached to a source, a fetch date, and an evidence level.

The design rule is one sentence:

> **FACT 与 ANALYSIS 永不混写。** Unknown stays `UNKNOWN`, never a fabricated zero.

When a source is unreachable, knowfirst records `ERROR` / `RATE_LIMITED` and keeps the last known fact
with its timestamp — it does not silently overwrite history, and it does not fill the gap with a
guess.

## What's inside

| Route | What it does |
|---|---|
| `/tool/<name>` | Frontier Card — sourced facts, license, status, declared-vs-tested capability |
| `/compare` | Projects side by side, FACT / ANALYSIS labelled separately |
| `/build` | Requirement coverage, evidence gaps, license gates → Build / Buy / Integrate verdict |
| `/radar` | 7 / 30 / 90-day events and real GitHub star observations |
| `/sources` | Per-source status, last fetch, facts and their temporal fields |
| `/settings` | Local account, technical profile, model status |

Scope at v0.1: **17 concepts, 7 projects**. This is a curated Internal MVP, not a web-scale
search engine — the seed data is deliberately small so every fact can be audited by hand.

## Quick start

Requirements: Node.js 24 LTS (verified on 24.19.0) and Git. Windows also needs Microsoft Edge for
the browser tests. **No Docker, no database server, no API key is needed for the default path** —
the app falls back to embedded PGlite.

```powershell
git clone https://github.com/blairf932/knowfirst.git
cd knowfirst
npm ci
Copy-Item .env.example .env      # macOS/Linux: cp .env.example .env
npm run db:migrate
npm run db:seed
npm run radar:refresh
npm run build
npm start
```

Open <http://127.0.0.1:3100>.

Then create your own account on the **设置与技术档案** page (password ≥ 12 characters). Public
evidence is readable without login; your profile and progress stay in your local database.

> Port 3100 is reserved for this project — 3000 is often taken by something else.
> On Windows PowerShell, use `npm.cmd` to avoid the `npm.ps1` execution-policy block.

## Configuration

Everything lives in `.env` (never committed). All variables are optional; defaults work offline.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | If set, use a standard PostgreSQL server via `pg`. Otherwise embedded PGlite. |
| `PGLITE_DIR` | `.data/postgres` | Embedded database location. |
| `REQUIRE_STANDARD_POSTGRES` | — | `true` refuses to start on PGlite (for production guards). |
| `APP_ORIGIN` | `http://127.0.0.1:3100` | Exact origin used for write-request validation. Must match reality. |
| `GITHUB_TOKEN` | — | Optional. Raises the GitHub REST rate limit. Read-only use. |
| `LLM_PROVIDER` | — | `deepseek` enables optional model features. |
| `LLM_API_KEY` | — | Provider credential. Server-side only, never serialized into React. |
| `LLM_BASE_URL` | `https://api.deepseek.com` | Provider endpoint. |
| `LLM_MODEL` | provider default | Model identifier. |
| `LLM_DAILY_BUDGET_USD` | `0.10` | Global daily spend ceiling. |
| `LLM_USER_DAILY_BUDGET_USD` | `0.03` | Per-user daily ceiling. |
| `LLM_MAX_CALLS_PER_DAY` | `100` | Hard call ceiling. |

Without `LLM_API_KEY`, all evidence features work; only the model-assisted extras report
`UNAVAILABLE`. That is the intended way to read this project.

## Stack

Next.js 16.4 (App Router) · React 19.2 · TypeScript 7.0 · Zod 4.5 · PGlite 0.5 / PostgreSQL via `pg` 8.23
· Playwright 1.62 (browser acceptance) · exact pinned versions in `package-lock.json`.

Deliberately **not** included: Redis, graph database, vector database, microservices, ORM.
See [ADR 001](docs/ADR/001-stack.md) for the reasoning and [architecture](docs/ARCHITECTURE.md) for
the module map.

## Architecture in one paragraph

A modular monolith. Source protocols live in `lib/adapters/*` behind a fixed allowlist with bounded
fetch; ingestion validates, deduplicates and appends observations so facts change over time instead
of being overwritten; `lib/intelligence.ts` holds pure decision rules; a single SQL interface in
`lib/db.ts` owns transactions, the migration ledger and the single-process lock. LLM vendors sit
behind one `LLMProvider` interface with structured-output validation and a usage ledger. Adding a
database or a queue requires an ADR proving the need.

## Tests

```powershell
npm run typecheck
npm test              # Node + PGlite integration suite
npm run build
npm run test:browser  # real Microsoft Edge against a running app on 3100
npm run test:postgres # requires a local PostgreSQL lab
npm run licenses      # exits non-zero on any unreviewed dependency license
npm audit
```

Browser tests create throwaway `example.test` accounts in an isolated database; they never touch
another user's profile. Screenshots and Playwright reports land in `test-results/` and
`playwright-report/`, both git-ignored.

PostgreSQL-specific coverage lives in `npm run test:postgres`, which spins an isolated cluster; see
[POSTGRES_ACCEPTANCE.md](docs/POSTGRES_ACCEPTANCE.md) for the lab layout.

## Data, backup and privacy

- Passwords: `scrypt` with a random salt. Sessions: 32 random bytes, only a SHA-256 digest stored,
  7-day expiry, revoked on logout.
- Cookies: `HttpOnly`, `SameSite=Lax`, `Secure` when `APP_ORIGIN` is HTTPS.
- Write APIs verify `Origin`, derive the user from the real session, never trust `X-Forwarded-For`.
- All SQL is parameterised; JSON input is Zod-validated; request bodies are stream-read with a 16,000-byte cap.
- Backups are JSON and contain account hashes and personal profiles — restrict file access and
  encrypt before moving them off-machine. `backups/` and `.data/` are git-ignored.
- `npm run db:restore` only restores into an empty dedicated database. It never truncates a live one.

See [PRIVACY_DATA_LIFECYCLE.md](docs/PRIVACY_DATA_LIFECYCLE.md) for the full lifecycle.

## Known limits

This is a **local Internal MVP**, not a production SaaS:

- No email verification, password reset or OAuth. Accounts are local to your machine.
- No billing, no data-export UI, no durable scheduler (refresh is bounded but synchronous).
- Registration is open (no invite, no email verification). Fine while the app is loopback-only,
  but a real hole if exposed to the internet — see
  [Open registration and public exposure](docs/PRIVACY_DATA_LIFECYCLE.md#open-registration-and-public-exposure).
- No Mem0 / OpenClaw runtime compatibility certification; compatibility claims are declared-bound,
  not tested.
- No vector search — retrieval is canonical-ID and bilingual-alias matching, deliberately.
- Dependency license review is an engineering assessment, not legal advice. See
  [LICENSE_AUDIT.md](docs/LICENSE_AUDIT.md) and [COMMERCIAL_RISKS.md](docs/COMMERCIAL_RISKS.md)
  before any paid deployment.

## Documentation

| Doc | Content |
|---|---|
| [FEATURE_STATUS.md](docs/FEATURE_STATUS.md) | Per-feature status, evidence level, and the claims most likely to be overstated |
| [PRODUCT_VISION.md](docs/PRODUCT_VISION.md) | What success means, and what this refuses to do |
| [ROADMAP.md](docs/ROADMAP.md) | Where this is going, and what it refuses to become |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module responsibilities and data flow |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Tables, temporal fields, evidence levels |
| [RESEARCH_PIPELINE.md](docs/RESEARCH_PIPELINE.md) | How staged evidence composition works |
| [SOURCE_POLICY.md](docs/SOURCE_POLICY.md) | Allowlist, fetch limits, retry and failure semantics |
| [LLM_STRATEGY.md](docs/LLM_STRATEGY.md) | Provider boundary, structured output, budget guards |
| [SCHEDULER.md](docs/SCHEDULER.md) | Batch jobs, locking, deadlines |
| [PRIVACY_DATA_LIFECYCLE.md](docs/PRIVACY_DATA_LIFECYCLE.md) | Account and data lifecycle |
| [COMPATIBILITY_MATRIX.md](docs/COMPATIBILITY_MATRIX.md) | Declared vs tested capability levels |
| [LICENSE_AUDIT.md](docs/LICENSE_AUDIT.md) | Per-dependency license disposition |
| [COMMERCIAL_RISKS.md](docs/COMMERCIAL_RISKS.md) | Risk table and gates before paid release |
| [ADR/001-stack.md](docs/ADR/001-stack.md) | Why this stack, what was rejected |

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The one rule that runs through
every file: **keep evidence labels honest.** A source declaration, an analysis, and a tested result
are three different things, and the codebase is built to keep them apart.

Security reports: [SECURITY.md](SECURITY.md) — please report privately, not in a public issue.

## License

[MIT](LICENSE). Copyright (c) 2026 knowfirst contributors. Third-party dependencies keep their own
licenses — see [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt). MIT grants no rights to third-party
trademarks, dataset or service terms.


## No warranty

Experimental software, published under the MIT license with no warranty of any kind. In concrete terms:

- Facts shown in the UI come from third-party sources at a point in time. They can be wrong, stale, or mis-parsed. Verify before acting on them.
- Nothing here is investment, legal or purchasing advice.
- The license review under `docs/` is an engineering assessment, not a legal opinion.
- There is no support commitment and no security response SLA. Fixes happen when they happen.

---

## 中文说明

**knowfirst**（原名 AI Frontier Intelligence，缩写 AFI）是一个本地优先的 AI 生态研究工作台。它不做"AI 榜单"，
也不做"信口开河的聊天"，而是把每条结论都绑到来源、抓取日期和证据等级上。

核心设计只有一句：**FACT 与 ANALYSIS 永不混写。** 没有证据就显示 `UNKNOWN`，绝不填零；
来源抓不到就记 `ERROR` / `RATE_LIMITED` 并保留带时间戳的旧事实——历史只追加，不覆盖。

**功能**：Frontier Card（技术卡）、多项目并排比较、Build/Buy/Integrate 判断、7/30/90 天
Radar 事件、来源状态页、本地账户与技术档案。v0.1 只有 **17 个概念、7 个项目**，范围小到
每条事实都可以人工复核。

**启动**：装 Node 24，`npm ci` → 复制 `.env.example` 为 `.env` → `npm run db:migrate` →
`npm run db:seed` → `npm run radar:refresh` → `npm run build` → `npm start`，
打开 <http://127.0.0.1:3100>。默认走内置 PGlite，**不需要 Docker、数据库服务或任何 API Key**。
Windows PowerShell 请用 `npm.cmd`。

**边界**：这是本地 Internal MVP，不是生产 SaaS。没有邮箱验证/找回密码/OAuth，没有计费，
没有持久调度器，没有向量检索。**注册默认是开放的**——本地用没问题（只有你自己能访问），但把应用放到公网前必须先关掉注册（加邀请码、白名单或直接禁用），否则陌生人能随便注册、还可能消耗你的模型额度。许可证审查是工程判断，
不构成法律意见。

**文档**：架构、数据模型、来源策略、模型策略、隐私生命周期、许可审计、商业化风险见
[`docs/`](docs/)。

---

*缺少证据时保持 UNKNOWN。不要把它在本地跑通，等同于获得了商业生产发布许可。*
