CREATE TABLE evidence_claims (
 id text PRIMARY KEY,
 source_id text NOT NULL REFERENCES sources(id),
 observation_id text REFERENCES source_observations(id),
 source_url text NOT NULL,
 source_type text NOT NULL,
 retrieved_at timestamptz NOT NULL,
 published_at timestamptz,
 locator jsonb NOT NULL CHECK(jsonb_typeof(locator)='object'),
 extracted_claim jsonb NOT NULL,
 confidence double precision NOT NULL CHECK(confidence BETWEEN 0 AND 1),
 verification_status text NOT NULL CHECK(verification_status IN ('URL_ONLY','SOURCE_VERIFIED','CLAIM_VERIFIED','CROSS_VERIFIED')),
 CHECK (confidence < 0.85 OR (verification_status IN ('CLAIM_VERIFIED','CROSS_VERIFIED') AND locator <> '{}'::jsonb))
);
ALTER TABLE facts ADD COLUMN claim_id text REFERENCES evidence_claims(id);
ALTER TABLE facts ADD COLUMN verification_status text NOT NULL DEFAULT 'SOURCE_VERIFIED' CHECK(verification_status IN ('URL_ONLY','SOURCE_VERIFIED','CLAIM_VERIFIED','CROSS_VERIFIED'));
-- Old snapshots do not contain a sufficient locator. Do not invent retrospective verification.
UPDATE facts SET confidence=LEAST(confidence,0.84);
ALTER TABLE facts ADD CONSTRAINT high_requires_claim CHECK(confidence<0.85 OR (claim_id IS NOT NULL AND verification_status IN ('CLAIM_VERIFIED','CROSS_VERIFIED')));
CREATE INDEX evidence_source_time ON evidence_claims(source_id,retrieved_at);
CREATE TABLE compatibility_evidence (
 id text PRIMARY KEY,
 from_id text NOT NULL REFERENCES entities(id),
 to_id text NOT NULL REFERENCES entities(id),
 level text NOT NULL CHECK(level IN ('DECLARED','COMMUNITY_VERIFIED','INTERNAL_VERIFIED')),
 source_id text REFERENCES sources(id),
 versions jsonb NOT NULL DEFAULT '{}',
 environment jsonb NOT NULL DEFAULT '{}',
 checks jsonb NOT NULL DEFAULT '{}',
 evidence_locator text NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT now(),
 CHECK(level='DECLARED' OR (versions<>'{}'::jsonb AND checks<>'{}'::jsonb))
);
