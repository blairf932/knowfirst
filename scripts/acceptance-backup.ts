import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { database, closeDatabase } from '../lib/db';
import { exportBackup, restoreBackup, backupTables } from '../lib/backup';
import { hashPassword, createSession, verifyPassword } from '../lib/auth';
import { randomUUID } from 'node:crypto';
const source = new URL(process.env.DATABASE_URL!);
assert.equal(source.hostname, '127.0.0.1');
assert.equal(source.pathname, '/frontier_acceptance_v011');
try {
  const db = await database();
  const userId = randomUUID();
  const password = 'test-only-backup-' + randomUUID();
  await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
    userId,
    userId + '@example.test',
    await hashPassword(password),
  ]);
  const context = {
    uses: ['backup-sentinel'],
    interests: ['长期记忆'],
    building: 'test-only restore marker',
    learned: [],
  };
  await db.query('INSERT INTO user_contexts(user_id,context) VALUES($1,$2)', [
    userId,
    JSON.stringify(context),
  ]);
  await createSession(userId);
  const payload = await exportBackup(db);
  assert.ok((payload.sessions as unknown[]).length > 0);
  await writeFile('.cache/acceptance-logical-backup.json', JSON.stringify(payload), {
    mode: 0o600,
  });
  await closeDatabase();
  source.pathname = '/frontier_restore_v011';
  process.env.DATABASE_URL = source.href;
  const target = await database();
  const restored = await restoreBackup(target, payload);
  assert.equal(restored.status, 'AVAILABLE');
  const excluded = [
    'schema_migrations',
    'sessions',
    'rate_limits',
    'job_locks',
    'card_cache',
    'llm_cache',
    'audit_log',
  ];
  let matched = 0;
  for (const table of backupTables.filter((x) => !excluded.includes(x))) {
    const actual = (await target.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
    assert.equal(actual, (payload[table] as unknown[]).length, table);
    matched++;
  }
  assert.equal((await target.query('SELECT count(*)::int n FROM sessions')).rows[0].n, 0);
  const user = (
    await target.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1', [
      userId,
    ])
  ).rows[0];
  assert.ok(await verifyPassword(password, user.password_hash));
  assert.deepEqual(
    (await target.query('SELECT context FROM user_contexts WHERE user_id=$1', [userId])).rows[0]
      .context,
    context,
  );
  await assert.rejects(restoreBackup(target, payload), /destination must be an empty database/);
  const evidence = {
    status: 'PASS',
    format: payload.format,
    tablesCompared: matched,
    sessionsRevoked: true,
    nonemptyRestoreRefused: true,
    nonemptySessionBackup: true,
    restoredPasswordAndContext: true,
  };
  await writeFile('.cache/backup-acceptance.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await closeDatabase();
}
