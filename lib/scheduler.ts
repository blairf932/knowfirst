import { randomUUID } from 'node:crypto';
import { database } from './db';
import { adapters } from './adapters';
import { FetchFailure } from './adapters/http';
import { persistCollection } from './ingestion';
import type { Source } from './domain';
import type { Collected } from './adapters/types';

export const freshnessPolicies = {
  evergreen: 2160,
  tool: 168,
  pricing: 24,
  release: 6,
  events: 6,
  signals: 6,
} as const;
export function sourcePolicy(adapter: string): keyof typeof freshnessPolicies {
  return adapter === 'document'
    ? 'evergreen'
    : adapter === 'releases'
      ? 'release'
      : adapter === 'github'
        ? 'signals'
        : adapter === 'hackernews' || adapter === 'arxiv'
          ? 'events'
          : 'tool';
}
export async function enqueueSources(only?: string, force = false) {
  const db = await database();
  const sources = (
    await db.query<Source>('SELECT * FROM sources WHERE ($1::text IS NULL OR id=$1)', [
      only ?? null,
    ])
  ).rows;
  const ids: string[] = [];
  for (const s of sources) {
    const policy = sourcePolicy(s.adapter);
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO research_jobs(id,source_id,policy) SELECT $1,$2,$3 WHERE $4 OR ((SELECT retrieved_at FROM sources WHERE id=$2) IS NULL OR (SELECT retrieved_at FROM sources WHERE id=$2)<now()-($5::text||' hours')::interval) AND NOT EXISTS (SELECT 1 FROM research_jobs WHERE source_id=$2 AND created_at>now()-($5::text||' hours')::interval) ON CONFLICT DO NOTHING RETURNING id`,
      [randomUUID(), s.id, policy, force, freshnessPolicies[policy]],
    );
    if (inserted.rows[0]) ids.push(inserted.rows[0].id);
  }
  return ids;
}
export async function claimJob() {
  const db = await database();
  return db.transaction(async (tx) => {
    // A worker holds this row throughout the network request: SKIP LOCKED never steals active work.
    await tx.query(
      `UPDATE research_jobs SET status=CASE WHEN attempts>=3 THEN 'FAILED' ELSE 'PENDING' END, owner=NULL,lease_until=NULL,error_code='LEASE_EXPIRED' WHERE id IN (SELECT id FROM research_jobs WHERE status='RUNNING' AND lease_until<now() FOR UPDATE SKIP LOCKED)`,
    );
    const owner = randomUUID();
    return (
      await tx.query<{ id: string; source_id: string; owner: string; attempts: number }>(
        `UPDATE research_jobs SET status='RUNNING', attempts=attempts+1,owner=$1,lease_until=now()+interval '2 minutes' WHERE id=(SELECT id FROM research_jobs WHERE status='PENDING' AND available_at<=now() AND attempts<3 ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,source_id,owner,attempts`,
        [owner],
      )
    ).rows[0];
  });
}
export async function workOne(collect?: (s: Source) => Promise<Collected>) {
  const db = await database();
  const job = await claimJob();
  if (!job) return null;
  return db.transaction(async (tx) => {
    const active = (
      await tx.query(
        'SELECT id FROM research_jobs WHERE id=$1 AND owner=$2 AND status=$3 FOR UPDATE',
        [job.id, job.owner, 'RUNNING'],
      )
    ).rows[0];
    if (!active) return null;
    const s = (
      await tx.query<Source>('SELECT * FROM sources WHERE id=$1 FOR UPDATE', [job.source_id])
    ).rows[0];
    let c: Collected;
    try {
      c = collect ? await collect(s) : await adapters.get(s.adapter)!.collect(s);
    } catch (e) {
      c = {
        status: e instanceof FetchFailure ? e.status : 'ERROR',
        metadata: {},
        error: e instanceof FetchFailure ? e.message : 'COLLECTION_FAILED',
      };
    }
    await persistCollection(tx, s, c);
    const status =
      c.status === 'AVAILABLE'
        ? 'SUCCESS'
        : c.status === 'PARTIAL'
          ? 'PARTIAL'
          : c.status === 'RATE_LIMITED'
            ? 'RATE_LIMITED'
            : 'FAILED';
    const retry = ['FAILED', 'RATE_LIMITED'].includes(status) && job.attempts < 3;
    await tx.query(
      `UPDATE research_jobs SET status=$3,available_at=now()+($4::text||' seconds')::interval,owner=NULL,lease_until=NULL,finished_at=CASE WHEN $5 THEN NULL ELSE now() END,error_code=$6 WHERE id=$1 AND owner=$2`,
      [
        job.id,
        job.owner,
        retry ? 'PENDING' : status,
        Math.min(3600, 60 * 2 ** job.attempts),
        retry,
        retry ? status : (c.error ?? null),
      ],
    );
    await tx.query('DELETE FROM card_cache');
    return { id: s.id, jobId: job.id, status: c.status, jobStatus: status, retryScheduled: retry };
  });
}
export async function runPending(limit = 3) {
  const results = [];
  for (let i = 0; i < limit; i++) {
    const r = await workOne();
    if (!r) break;
    results.push(r);
  }
  return results;
}
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight: Promise<void> | undefined;
let stopping = false;
export async function stopScheduler() {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = undefined;
  await inFlight;
}
export function startScheduler() {
  if (timer) return;
  stopping = false;
  const tick = async () => {
    if (stopping || inFlight) return;
    try {
      const { retentionSweep } = await import('./privacy');
      await retentionSweep();
      await enqueueSources();
      await runPending();
    } catch {
      console.error(JSON.stringify({ event: 'scheduler.failure' }));
    }
  };
  const launch = () => {
    if (stopping || inFlight) return;
    inFlight = tick().finally(() => {
      inFlight = undefined;
    });
  };
  timer = setInterval(launch, 15000);
  timer.unref();
  launch();
}
