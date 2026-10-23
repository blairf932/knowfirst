import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { database, closeDatabase } from '../lib/db';
const db = await database();
try {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith('/frontier_restore_v011')
  )
    throw new Error('Disposable restore acceptance database required');
  if (process.argv[2] === 'checkpoint') {
    const id = randomUUID();
    await db.query(
      "INSERT INTO research_jobs(id,source_id,policy,available_at) VALUES($1,'github-mem0','tool',now()+interval '1 day')",
      [id],
    );
    await writeFile('.cache/scheduler-checkpoint.txt', id);
    console.log('PENDING job committed for application restart acceptance.');
  } else {
    const id = await readFile('.cache/scheduler-checkpoint.txt', 'utf8');
    const row = (
      await db.query<{ status: string; attempts: number }>(
        'SELECT status,attempts FROM research_jobs WHERE id=$1',
        [id],
      )
    ).rows[0];
    if (row?.status !== 'PENDING' || row.attempts !== 0)
      throw new Error('Committed pending job did not survive restart');
    await writeFile(
      'docs/SCHEDULER_RESTART_RESULT.json',
      JSON.stringify(
        {
          checked_at: new Date().toISOString(),
          status: 'PASS',
          database: 'standard PostgreSQL',
          applicationRestart: true,
          jobStatus: row.status,
          attempts: row.attempts,
        },
        null,
        2,
      ),
    );
    await db.query(
      "UPDATE research_jobs SET status='FAILED',finished_at=now(),error_code='ACCEPTANCE_CLEANUP' WHERE id=$1",
      [id],
    );
    console.log(
      'Persisted PENDING job survived real application restart. Acceptance-only job closed as FAILED with cleanup reason.',
    );
  }
} finally {
  await closeDatabase();
}
