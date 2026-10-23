import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { database, closeDatabase } from '../lib/db';
import { exportBackup, restoreBackup } from '../lib/backup';
const command = process.argv[2];
const db = await database();
const origin = 'http://127.0.0.1:3101';
async function post(route: string, body: unknown, cookie?: string) {
  const r = await fetch(`${origin}/api/${route}`, {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Acceptance API ${route} ${r.status}`);
  return r;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function state() {
  const result: Record<string, unknown> = {};
  for (const table of ['entities', 'sources', 'facts', 'evidence_claims', 'events'])
    result[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  return {
    digest: hash(result),
    counts: Object.fromEntries(
      Object.entries(result).map(([k, v]) => [k, (v as unknown[]).length]),
    ),
  };
}
try {
  if (
    !process.env.DATABASE_URL ||
    !(await db.query<{ version: string }>('SELECT version()')).rows[0].version.includes('windows')
  )
    throw new Error('Standard native PostgreSQL required');
  if (command === 'checkpoint') {
    const users = [];
    for (const name of ['A', 'B']) {
      const credentials = {
        email: `pg-${name}-${randomUUID()}@example.test`,
        password: randomUUID() + randomUUID(),
      };
      const registration = await post('auth/register', credentials);
      const cookie = registration.headers.get('set-cookie')!.split(';')[0];
      const profile = {
        uses: [`Private-${name}`],
        interests: ['MCP'],
        building: `PostgreSQL ${name}`,
        learned: [],
      };
      await post('context', profile, cookie);
      users.push({ credentials, profile });
    }
    await writeFile('.cache/pg-checkpoint.json', JSON.stringify({ users, ...(await state()) }), {
      mode: 0o600,
    });
    console.log(JSON.stringify({ checkpoint: 'PASS', ...(await state()) }));
  } else if (command === 'verify') {
    const saved = JSON.parse(await readFile('.cache/pg-checkpoint.json', 'utf8'));
    const current = await state();
    if (current.digest !== saved.digest)
      throw new Error('Public evidence changed across restart/restore');
    for (const user of saved.users) {
      const login = await post('auth/login', user.credentials);
      const cookie = login.headers.get('set-cookie')!.split(';')[0];
      const me = await (await fetch(`${origin}/api/me`, { headers: { cookie } })).json();
      assert.deepEqual(me.context, user.profile, 'User context persistence mismatch');
    }
    const health = await (await fetch(`${origin}/api/health`)).json();
    if (health.database !== 'PostgreSQL') throw new Error('Database fallback is forbidden');
    const record = {
      checked_at: new Date().toISOString(),
      database: health.database,
      status: 'PASS',
      ...current,
      users: 'A/B profiles persisted independently',
    };
    await writeFile(
      `docs/PG_${new URL(process.env.DATABASE_URL!).pathname.includes('restore') ? 'RESTORE' : 'RESTART'}_RESULT.json`,
      JSON.stringify(record, null, 2),
    );
    console.log(JSON.stringify(record));
  } else if (command === 'backup') {
    await mkdir('backups', { recursive: true });
    const backup = await exportBackup(db);
    await writeFile('backups/pg-v011-acceptance.json', JSON.stringify(backup), { mode: 0o600 });
    console.log('Consistent standard PostgreSQL logical backup saved.');
  } else if (command === 'restore') {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/frontier_restore_v011'))
      throw new Error('Restore requires the named clean acceptance destination');
    console.log(
      await restoreBackup(
        db,
        JSON.parse(await readFile('backups/pg-v011-acceptance.json', 'utf8')),
      ),
    );
    if ((await db.query('SELECT 1 FROM sessions')).rows.length)
      throw new Error('Restored sessions must be revoked');
  } else throw new Error('Use checkpoint,verify,backup,restore');
} finally {
  await closeDatabase();
}
