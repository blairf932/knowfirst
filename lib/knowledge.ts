import { database } from './db';
import { seed } from './seed';
import {
  emptyContext,
  type Snapshot,
  type UserContext,
  type Entity,
  type Fact,
  type Source,
  type FrontierEvent,
  type Signal,
  freshness,
  ttlHours,
} from './domain';
let seeded: Promise<void> | undefined;
const iso = (x: unknown): string => (x instanceof Date ? x.toISOString() : String(x));
export async function snapshot(asOf?: string): Promise<Snapshot> {
  await (seeded ??= seed().catch((e) => {
    seeded = undefined;
    throw e;
  }));
  const db = await database();
  const at = asOf ? new Date(asOf).toISOString() : new Date().toISOString();
  const [entities, sources, facts, events, signals, relationships] = await Promise.all([
    db.query<Entity>('SELECT * FROM entities ORDER BY name'),
    db.query<Source>('SELECT * FROM sources ORDER BY tier,title'),
    db.query<Fact>(
      `SELECT f.*, c.id AS claim_id, COALESCE(c.verification_status,'SOURCE_VERIFIED') AS verification_status, CASE WHEN c.id IS NULL THEN LEAST(f.confidence,0.84) ELSE c.confidence END AS confidence, to_jsonb(c) AS evidence FROM facts f LEFT JOIN LATERAL (SELECT e.* FROM evidence_claims e WHERE e.source_id=f.source_id AND e.extracted_claim=jsonb_build_object('predicate',f.predicate,'value',f.value) AND e.retrieved_at<=$1 AND e.retrieved_at>=f.valid_from ORDER BY e.retrieved_at DESC LIMIT 1) c ON true WHERE f.valid_from<=$1 AND (f.valid_until IS NULL OR f.valid_until>$1) AND f.discovered_at<=$1`,
      [at],
    ),
    db.query<FrontierEvent>(
      'SELECT * FROM events WHERE published_at<=$1 AND discovered_at<=$1 ORDER BY published_at DESC LIMIT 150',
      [at],
    ),
    db.query<Signal>(
      'SELECT entity_id,source_id,metric,value,unit,status,observed_at FROM signals WHERE observed_at<=$1 ORDER BY observed_at DESC',
      [at],
    ),
    db.query<Snapshot['relationships'][number]>(
      'SELECT from_id,to_id,predicate,source_id,kind FROM relationships WHERE valid_from<=$1 AND (valid_until IS NULL OR valid_until>$1)',
      [at],
    ),
  ]);
  const serialized = JSON.parse(
    JSON.stringify({
      entities: entities.rows,
      sources: sources.rows,
      facts: facts.rows,
      events: events.rows,
      signals: signals.rows,
      relationships: relationships.rows,
    }),
  ) as Snapshot;
  if (asOf) {
    // Source health and verification must also be reconstructed as known at that time.
    for (const s of serialized.sources) {
      const old = (
        await db.query<{
          status: Source['status'];
          retrieved_at: string;
          metadata: Record<string, unknown>;
          error: string | null;
        }>(
          'SELECT status,retrieved_at,metadata,error FROM source_observations WHERE source_id=$1 AND retrieved_at<=$2 ORDER BY retrieved_at DESC LIMIT 1',
          [s.id, at],
        )
      ).rows[0];
      s.status = old?.status ?? 'UNAVAILABLE';
      s.retrieved_at = old ? iso(old.retrieved_at) : null;
      s.metadata = old?.metadata ?? {};
      s.error = old?.error ?? null;
    }
    for (const f of serialized.facts) {
      const v = (
        await db.query<{ verified_at: string }>(
          'SELECT verified_at FROM fact_verifications WHERE fact_id=$1 AND verified_at<=$2 ORDER BY verified_at DESC LIMIT 1',
          [f.id, at],
        )
      ).rows[0];
      f.last_verified_at = v ? iso(v.verified_at) : f.discovered_at;
    }
  }
  serialized.revision = serialized.sources
    .map((x) => `${x.id}:${x.retrieved_at}:${x.status}`)
    .join('|');
  return serialized;
}
export async function userContext(userId?: string): Promise<UserContext> {
  if (!userId) return emptyContext;
  const db = await database();
  return (
    (
      await db.query<{ context: UserContext }>(
        'SELECT context FROM user_contexts WHERE user_id=$1',
        [userId],
      )
    ).rows[0]?.context ?? emptyContext
  );
}

export * from './intelligence';
