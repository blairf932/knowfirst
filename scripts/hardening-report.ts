import { writeFile, readFile } from 'node:fs/promises';
import { database, closeDatabase } from '../lib/db';
const db = await database();
try {
  const checks = JSON.parse(await readFile('docs/COMPATIBILITY_ACCEPTANCE.json', 'utf8'));
  for (const [i, entity] of ['mem0', 'supermemory'].entries()) {
    const source = (
      await db.query<{ url: string; retrieved_at: string }>(
        'SELECT url,retrieved_at FROM sources WHERE id=$1',
        [`integration-${entity}`],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO compatibility_evidence(id,from_id,to_id,level,source_id,versions,environment,checks,evidence_locator,verified_at) VALUES($1,$2,'openclaw','DECLARED',$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET versions=excluded.versions,checks=excluded.checks,environment=excluded.environment",
      [
        `declared-integration-${entity}`,
        entity,
        `integration-${entity}`,
        JSON.stringify({
          plugin: checks.results[i].version,
          host: 'NOT_INSTALLED',
          declaredHost: checks.results[i].declaredHost,
        }),
        JSON.stringify(checks.environment),
        JSON.stringify(checks.results[i]),
        source.url,
        source.retrieved_at,
      ],
    );
  }
  const result = {
    checked_at: new Date().toISOString(),
    database: (await db.query('SELECT version()')).rows[0],
    evidence: (
      await db.query(
        'SELECT verification_status,count(*)::int count,min(confidence) min_confidence,max(confidence) max_confidence FROM facts GROUP BY verification_status',
      )
    ).rows,
    sources: (await db.query('SELECT status,count(*)::int count FROM sources GROUP BY status'))
      .rows,
    jobs: (await db.query('SELECT status,count(*)::int count FROM research_jobs GROUP BY status'))
      .rows,
    models: (
      await db.query(
        'SELECT status,task_type,count(*)::int count,sum(estimated_cost) estimated_cost,sum(input_tokens)::int input_tokens,sum(output_tokens)::int output_tokens FROM llm_usage GROUP BY status,task_type ORDER BY status,task_type',
      )
    ).rows,
    compatibility: (
      await db.query('SELECT from_id,to_id,level,versions,verified_at FROM compatibility_evidence')
    ).rows,
  };
  await writeFile('docs/FOUNDATION_STATUS.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await closeDatabase();
}
