import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { type DB } from './db';
import type { Source } from './domain';
import type { Collected } from './adapters/types';
export async function persistCollection(
  tx: DB,
  s: Source,
  c: Collected,
  now = new Date().toISOString(),
) {
  await tx.query('SELECT id FROM sources WHERE id=$1 FOR UPDATE', [s.id]);
  const observationId = randomUUID();
  const hash = createHash('sha256').update(JSON.stringify(c.metadata)).digest('hex');
  await tx.query(
    'INSERT INTO source_observations(id,source_id,retrieved_at,status,content_hash,metadata,error) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [observationId, s.id, now, c.status, hash, JSON.stringify(c.metadata), c.error ?? null],
  );
  const successful = c.status === 'AVAILABLE' || c.status === 'PARTIAL';
  await tx.query(
    'UPDATE sources SET status=$2,retrieved_at=CASE WHEN $3 THEN $4::timestamptz ELSE retrieved_at END,error=$5,metadata=CASE WHEN $3 THEN $6::jsonb ELSE metadata END WHERE id=$1',
    [s.id, c.status, successful, now, c.error ?? null, JSON.stringify(c.metadata)],
  );
  if (!s.entity_id || !successful) return;
  for (const f of c.facts ?? []) {
    if (s.tier === 'C' && f.confidence >= 0.85)
      throw new Error('Tier C cannot support a high-confidence fact');
    const locator = f.locator ?? {};
    const verification = Object.keys(locator).length ? 'CLAIM_VERIFIED' : 'SOURCE_VERIFIED';
    const confidence =
      verification === 'CLAIM_VERIFIED' ? f.confidence : Math.min(f.confidence, 0.84);
    const claimId = randomUUID();
    await tx.query(
      'INSERT INTO evidence_claims(id,source_id,observation_id,source_url,source_type,retrieved_at,published_at,locator,extracted_claim,confidence,verification_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        claimId,
        s.id,
        observationId,
        s.url,
        s.adapter,
        now,
        f.published_at ?? null,
        JSON.stringify(locator),
        JSON.stringify({ predicate: f.predicate, value: f.value }),
        confidence,
        verification,
      ],
    );
    const old = (
      await tx.query<{ id: string; value: unknown }>(
        'SELECT id,value FROM facts WHERE entity_id=$1 AND predicate=$2 AND source_id=$3 AND valid_until IS NULL',
        [s.entity_id, f.predicate, s.id],
      )
    ).rows[0];
    let id = old?.id;
    if (!old || !isDeepStrictEqual(old.value, f.value)) {
      if (old) await tx.query('UPDATE facts SET valid_until=$2 WHERE id=$1', [old.id, now]);
      id = randomUUID();
      await tx.query(
        'INSERT INTO facts(id,entity_id,predicate,value,source_id,kind,confidence,discovered_at,published_at,valid_from,last_verified_at,claim_id,verification_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$8,$10,$11)',
        [
          id,
          s.entity_id,
          f.predicate,
          JSON.stringify(f.value),
          s.id,
          'FACT',
          confidence,
          now,
          f.published_at ?? null,
          claimId,
          verification,
        ],
      );
      if (old)
        await tx.query(
          'INSERT INTO events(id,entity_id,source_id,title,event_type,published_at,discovered_at,url) VALUES($1,$2,$3,$4,$5,$6,$6,$7)',
          [
            randomUUID(),
            s.entity_id,
            s.id,
            `${f.predicate} changed`,
            'OBSERVED_CHANGE',
            now,
            s.url,
          ],
        );
    } else
      await tx.query(
        'UPDATE facts SET last_verified_at=$2,claim_id=$3,verification_status=$4,confidence=$5 WHERE id=$1',
        [id, now, claimId, verification, confidence],
      );
    await tx.query(
      'INSERT INTO fact_verifications(fact_id,source_id,verified_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [id, s.id, now],
    );
  }
  // A previously detected README phrase disappearing retires the old claim; no false inference of feature removal.
  if (s.adapter === 'readme' || s.adapter === 'integration') {
    const active = (
      await tx.query<{ id: string; predicate: string }>(
        'SELECT id,predicate FROM facts WHERE source_id=$1 AND valid_until IS NULL',
        [s.id],
      )
    ).rows;
    for (const f of active)
      if (!(c.facts ?? []).some((x) => x.predicate === f.predicate))
        await tx.query('UPDATE facts SET valid_until=$2 WHERE id=$1', [f.id, now]);
  }
  if (s.adapter === 'integration') {
    const declared = c.facts?.some((f) => f.predicate === 'documented_integration_openclaw');
    const edge = (
      await tx.query<{ id: string }>(
        'SELECT id FROM relationships WHERE source_id=$1 AND predicate=$2 AND valid_until IS NULL',
        [s.id, 'DOCUMENTS_INTEGRATION_WITH'],
      )
    ).rows[0];
    if (declared && !edge)
      await tx.query(
        'INSERT INTO relationships(id,from_id,to_id,predicate,source_id,kind,valid_from,discovered_at,confidence) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8)',
        [
          randomUUID(),
          s.entity_id,
          'openclaw',
          'DOCUMENTS_INTEGRATION_WITH',
          s.id,
          'FACT',
          now,
          0.9,
        ],
      );
    if (declared)
      await tx.query(
        "INSERT INTO compatibility_evidence(id,from_id,to_id,level,source_id,evidence_locator,verified_at) VALUES($1,$2,'openclaw','DECLARED',$3,$4,$5) ON CONFLICT(id) DO UPDATE SET verified_at=excluded.verified_at",
        [`declared-${s.id}`, s.entity_id, s.id, s.url, now],
      );
    if (!declared && edge)
      await tx.query('UPDATE relationships SET valid_until=$2 WHERE id=$1', [edge.id, now]);
  }
  for (const e of c.events ?? [])
    await tx.query(
      'INSERT INTO events(id,entity_id,source_id,title,event_type,published_at,discovered_at,url) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
      [e.id, s.entity_id, s.id, e.title, e.event_type, e.published_at, now, e.url],
    );
  for (const x of c.signals ?? [])
    await tx.query(
      'INSERT INTO signals(id,entity_id,source_id,metric,value,unit,status,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [randomUUID(), s.entity_id, s.id, x.metric, x.value, x.unit, 'AVAILABLE', now],
    );
}
export async function refreshSources(only?: string) {
  const { enqueueSources, runPending } = await import('./scheduler');
  const ids = await enqueueSources(only, true);
  if (!ids.length)
    return {
      status: 'RATE_LIMITED',
      message: 'No new approved source job; active jobs are preserved',
      results: [],
    };
  const results = await runPending(ids.length);
  return {
    status: results.every((x) => x.status === 'AVAILABLE') ? 'AVAILABLE' : 'PARTIAL',
    results,
    jobIds: ids,
  };
}
