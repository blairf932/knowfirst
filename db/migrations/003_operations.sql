CREATE TABLE research_jobs (
 id text PRIMARY KEY,
 source_id text NOT NULL REFERENCES sources(id),
 policy text NOT NULL CHECK(policy IN ('evergreen','tool','pricing','release','events','signals')),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','SUCCESS','PARTIAL','FAILED','RATE_LIMITED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 owner text,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 error_code text
);
CREATE UNIQUE INDEX one_active_source_job ON research_jobs(source_id) WHERE status IN ('PENDING','RUNNING');
CREATE INDEX jobs_due ON research_jobs(status,available_at);
CREATE TABLE llm_budgets (bucket text PRIMARY KEY, spent numeric NOT NULL DEFAULT 0 CHECK(spent>=0), reserved numeric NOT NULL DEFAULT 0 CHECK(reserved>=0));
ALTER TABLE llm_usage ADD COLUMN request_id text;
ALTER TABLE llm_usage ADD COLUMN card_id text;
ALTER TABLE llm_usage ADD COLUMN latency_ms integer;
ALTER TABLE llm_usage ADD COLUMN status text NOT NULL DEFAULT 'SUCCESS' CHECK(status IN ('RUNNING','SUCCESS','FAILED','BLOCKED','CACHED'));
ALTER TABLE llm_usage ADD COLUMN error_code text;
ALTER TABLE llm_usage ADD COLUMN reserved_cost numeric NOT NULL DEFAULT 0;
ALTER TABLE llm_usage ADD COLUMN cache_hit boolean NOT NULL DEFAULT false;
ALTER TABLE llm_usage ADD COLUMN price_basis jsonb;
CREATE INDEX llm_user_day ON llm_usage(user_id,created_at);
CREATE INDEX llm_request ON llm_usage(request_id);
CREATE INDEX llm_card ON llm_usage(card_id);
CREATE TABLE llm_cache (cache_key text PRIMARY KEY, user_id text REFERENCES users(id) ON DELETE CASCADE, result jsonb NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE erasure_tombstones (user_digest text PRIMARY KEY, erased_at timestamptz NOT NULL DEFAULT now());
