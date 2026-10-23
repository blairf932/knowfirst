import type { DB } from './db';
import { z } from 'zod';
import { ensureErasureLedger, applyErasureLedger } from './privacy';
export const backupTables = [
  'schema_migrations',
  'entities',
  'sources',
  'source_observations',
  'evidence_claims',
  'facts',
  'compatibility_evidence',
  'fact_verifications',
  'relationships',
  'events',
  'signals',
  'users',
  'sessions',
  'user_contexts',
  'research_runs',
  'card_cache',
  'llm_usage',
  'audit_log',
  'rate_limits',
  'job_locks',
  'research_jobs',
  'llm_budgets',
  'llm_cache',
  'erasure_tombstones',
] as const;
export async function exportBackup(db: DB) {
  await ensureErasureLedger();
  const payload: Record<string, unknown> = {
    format: 'ai-frontier-logical-v1',
    created_at: new Date().toISOString(),
  };
  await db.transaction(async (tx) => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const table of backupTables)
      payload[table] = (await tx.query(`SELECT * FROM ${table}`)).rows;
  });
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}
export async function restoreBackup(db: DB, raw: unknown) {
  const header = z
    .object({ format: z.literal('ai-frontier-logical-v1'), created_at: z.string() })
    .passthrough()
    .parse(raw);
  const rows = z.array(z.record(z.string(), z.unknown()));
  const payload = Object.fromEntries(backupTables.map((t) => [t, rows.parse(header[t])]));
  await db.transaction(async (tx) => {
    for (const table of backupTables.filter((t) => t !== 'schema_migrations'))
      if ((await tx.query(`SELECT 1 FROM ${table} LIMIT 1`)).rows.length)
        throw new Error(
          'Restore refused: destination must be an empty database. No data was removed.',
        );
    const current = (
      await tx.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')
    ).rows.map((r) => r.name);
    const expected = payload.schema_migrations.map((r) => r.name).sort();
    if (JSON.stringify(current) !== JSON.stringify(expected))
      throw new Error('Backup schema version differs from installed migrations');
    for (const table of backupTables.filter(
      (t) =>
        ![
          'schema_migrations',
          'sessions',
          'rate_limits',
          'job_locks',
          'card_cache',
          'llm_cache',
        ].includes(t),
    )) {
      const info = (
        await tx.query<{ column_name: string; data_type: string }>(
          'SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',
          ['public', table],
        )
      ).rows;
      for (const row of payload[table]) {
        const columns = Object.keys(row);
        if (!columns.length || columns.some((c) => !info.some((x) => x.column_name === c)))
          throw new Error(`Invalid backup columns in ${table}`);
        const values = columns.map((c) => {
          const v = row[c];
          return info.find((x) => x.column_name === c)?.data_type === 'jsonb' && v !== null
            ? JSON.stringify(v)
            : v;
        });
        await tx.query(
          `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(',')})`,
          values,
        );
      }
    }
    await applyErasureLedger(tx);
    await tx.query(
      "UPDATE research_jobs SET status=CASE WHEN attempts>=3 THEN 'FAILED' ELSE 'PENDING' END,owner=NULL,lease_until=NULL WHERE status='RUNNING'",
    );
    await tx.query(
      "UPDATE llm_usage SET status='FAILED',error_code='RESTORED_BILLING_UNKNOWN' WHERE status='RUNNING'",
    );
  });
  return { status: 'AVAILABLE', sessions: 'revoked', cache: 'cleared' };
}
