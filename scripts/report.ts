import { loadEnvFile } from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
try {
  loadEnvFile('.env');
} catch {}
const { database, closeDatabase } = await import('../lib/db');
try {
  const db = await database();
  const totals: Record<string, unknown> = {};
  for (const table of [
    'entities',
    'sources',
    'source_observations',
    'facts',
    'fact_verifications',
    'relationships',
    'events',
    'signals',
    'llm_usage',
  ])
    totals[table] = (
      await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`)
    ).rows[0].count;
  const report = {
    generated_at: new Date().toISOString(),
    database: (await db.query('SELECT version()')).rows[0],
    totals,
    entityKinds: (
      await db.query('SELECT kind,count(*)::int count FROM entities GROUP BY kind ORDER BY kind')
    ).rows,
    sourceStates: (
      await db.query(
        'SELECT status,count(*)::int count FROM sources GROUP BY status ORDER BY status',
      )
    ).rows,
    sources: (
      await db.query(
        'SELECT id,url,tier,adapter,status,retrieved_at,error FROM sources ORDER BY id',
      )
    ).rows,
  };
  await mkdir('docs', { recursive: true });
  await writeFile('docs/DATA_STATUS.json', JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      { generated_at: report.generated_at, totals, sourceStates: report.sourceStates },
      null,
      2,
    ),
  );
} finally {
  await closeDatabase();
}
