CREATE FUNCTION enforce_fact_claim() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE claim evidence_claims%ROWTYPE;
BEGIN
  IF NEW.claim_id IS NOT NULL THEN
    SELECT * INTO STRICT claim FROM evidence_claims WHERE id=NEW.claim_id;
    IF claim.source_id<>NEW.source_id OR claim.extracted_claim<>jsonb_build_object('predicate',NEW.predicate,'value',NEW.value)
      OR NEW.confidence>claim.confidence OR NEW.verification_status<>claim.verification_status THEN
      RAISE EXCEPTION 'Fact claim provenance mismatch';
    END IF;
  END IF;
  IF NEW.confidence>=0.85 AND (SELECT tier FROM sources WHERE id=NEW.source_id)='C' THEN
    RAISE EXCEPTION 'Tier C cannot support HIGH confidence';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fact_claim_integrity BEFORE INSERT OR UPDATE ON facts FOR EACH ROW EXECUTE FUNCTION enforce_fact_claim();
CREATE FUNCTION immutable_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Evidence claims are append-only'; END $$;
CREATE TRIGGER claim_immutable BEFORE UPDATE ON evidence_claims FOR EACH ROW EXECUTE FUNCTION immutable_claim();
