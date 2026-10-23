import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
const temp = await mkdtemp(path.join(os.tmpdir(), 'frontier-test-'));
process.env.PGLITE_DIR = temp;
if (process.env.TEST_POSTGRES_URL) {
  if (!new URL(process.env.TEST_POSTGRES_URL).pathname.endsWith('/frontier_tests_v011'))
    throw new Error('Unsafe test database');
  process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL;
} else delete process.env.DATABASE_URL;
process.env.ERASURE_LEDGER_PATH = path.join(temp, 'erasure.jsonl');
const { database, closeDatabase } = await import('../lib/db');
const { seed } = await import('../lib/seed');
const { persistCollection } = await import('../lib/ingestion');
const { snapshot, userContext } = await import('../lib/knowledge');
const { hashPassword, verifyPassword, createSession, sessionUser, rateLimit } =
  await import('../lib/auth');
const { research } = await import('../lib/research');
const { emptyContext } = await import('../lib/domain');
const { exportBackup, restoreBackup } = await import('../lib/backup');
test.after(async () => {
  await closeDatabase();
  assert.ok(temp.startsWith(os.tmpdir()) && path.basename(temp).startsWith('frontier-test-'));
  await rm(temp, { recursive: true, force: true });
});
test('PostgreSQL migration, temporal provenance, rollback, persistence and isolation', async (t) => {
  await seed();
  const db = await database();
  const s = (
    await db.query<import('../lib/domain').Source>('SELECT * FROM sources WHERE id=$1', [
      'github-mem0',
    ])
  ).rows[0];
  await t.test('SQL database and migrations really exist', async () => {
    const n = await db.query<{ n: number }>('SELECT count(*)::int n FROM schema_migrations');
    assert.ok(n.rows[0].n >= 2);
    const version = await db.query<{ version: string }>('SELECT version()');
    assert.match(version.rows[0].version, /PostgreSQL/);
  });
  await t.test('Changed fact retains prior valid interval', async () => {
    await db.transaction((tx) =>
      persistCollection(
        tx,
        s,
        {
          status: 'AVAILABLE',
          metadata: {},
          facts: [{ predicate: 'license', value: 'MIT', confidence: 0.95 }],
        },
        '2026-03-01T00:00:00Z',
      ),
    );
    await db.transaction((tx) =>
      persistCollection(
        tx,
        s,
        {
          status: 'AVAILABLE',
          metadata: {},
          facts: [{ predicate: 'license', value: 'Apache-2.0', confidence: 0.95 }],
        },
        '2026-04-01T00:00:00Z',
      ),
    );
    assert.equal(
      (await snapshot('2026-03-15')).facts.find((f) => f.predicate === 'license')?.value,
      'MIT',
    );
    assert.equal(
      (await snapshot('2026-04-15')).facts.find((f) => f.predicate === 'license')?.value,
      'Apache-2.0',
    );
    assert.equal((await snapshot('2026-02-01')).facts.length, 0);
  });
  await t.test('Unchanged fact deduplicates and tracks separate verification', async () => {
    await db.transaction((tx) =>
      persistCollection(
        tx,
        s,
        {
          status: 'AVAILABLE',
          metadata: {},
          facts: [{ predicate: 'license', value: 'Apache-2.0', confidence: 0.95 }],
        },
        '2026-05-01T00:00:00Z',
      ),
    );
    assert.equal((await db.query('SELECT * FROM facts WHERE source_id=$1', [s.id])).rows.length, 2);
    assert.equal(
      (await snapshot('2026-04-15')).facts[0].last_verified_at,
      '2026-04-01T00:00:00.000Z',
    );
  });
  await t.test('Failed source keeps prior facts and reports ERROR', async () => {
    await db.transaction((tx) =>
      persistCollection(
        tx,
        s,
        { status: 'ERROR', metadata: {}, error: 'HTTP 503' },
        '2026-06-01T00:00:00Z',
      ),
    );
    assert.equal((await snapshot()).sources.find((x) => x.id === s.id)?.status, 'ERROR');
    assert.equal((await snapshot()).facts.length, 1);
  });
  await t.test('Tier C high confidence is rolled back', async () => {
    await assert.rejects(() =>
      db.transaction((tx) =>
        persistCollection(
          tx,
          { ...s, tier: 'C' },
          {
            status: 'AVAILABLE',
            metadata: {},
            facts: [{ predicate: 'test', value: true, confidence: 0.99 }],
          },
        ),
      ),
    );
    assert.equal(
      (await db.query('SELECT * FROM facts WHERE predicate=$1', ['test'])).rows.length,
      0,
    );
  });
  const uid = randomUUID(),
    other = randomUUID();
  const hash = await hashPassword('a-real-internal-test-password');
  await t.test('Password hashing and opaque session authentication', async () => {
    assert.ok(await verifyPassword('a-real-internal-test-password', hash));
    assert.equal(await verifyPassword('wrong', hash), false);
    for (const id of [uid, other])
      await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
        id,
        `${id}@example.test`,
        hash,
      ]);
    const token = await createSession(uid);
    assert.equal((await sessionUser(token))?.id, uid);
    assert.equal(await sessionUser('forged'), null);
    assert.ok(
      !(await db.query<{ token_hash: string }>('SELECT token_hash FROM sessions')).rows.some(
        (x) => x.token_hash === token,
      ),
    );
  });
  await t.test('Profiles are isolated by authenticated user', async () => {
    await db.query('INSERT INTO user_contexts(user_id,context) VALUES($1,$2)', [
      uid,
      JSON.stringify({ ...emptyContext, interests: ['MCP'] }),
    ]);
    assert.deepEqual((await userContext(uid)).interests, ['MCP']);
    assert.deepEqual((await userContext(other)).interests, []);
  });
  await t.test('Database-backed rate limits enforce threshold', async () => {
    assert.equal(await rateLimit('test-bucket', 1, 60), true);
    assert.equal(await rateLimit('test-bucket', 1, 60), false);
  });
  await t.test(
    'Research cache reuses evidence while personal relevance remains per user',
    async () => {
      const d = await snapshot();
      const a = await research(d, '长期记忆', emptyContext, uid);
      const b = await research(d, '长期记忆', { ...emptyContext, interests: ['长期记忆'] }, other);
      assert.equal(a.cacheHit, false);
      assert.equal(b.cacheHit, true);
      assert.equal(a.matches[0].relevance.level, 'LOW');
      assert.equal(b.matches[0].relevance.level, 'HIGH');
    },
  );
  await t.test('Disk persistence survives a closed database and reopen', async () => {
    await closeDatabase();
    const reopened = await database();
    assert.equal((await reopened.query('SELECT * FROM users WHERE id=$1', [uid])).rows.length, 1);
  });
  await t.test('Logical backup restores into empty PostgreSQL and rejects overwrite', async () => {
    const current = await database();
    const exported = await exportBackup(current);
    await assert.rejects(() => restoreBackup(current, exported), /empty database/);
    const restoredDir = path.join(temp, 'restore');
    await closeDatabase();
    process.env.PGLITE_DIR = restoredDir;
    if (process.env.TEST_POSTGRES_URL) process.env.DATABASE_URL = process.env.TEST_RESTORE_URL;
    const restored = await database();
    await restoreBackup(restored, exported);
    assert.equal((await restored.query('SELECT * FROM users WHERE id=$1', [uid])).rows.length, 1);
    assert.deepEqual((await userContext(uid)).interests, ['MCP']);
    assert.equal((await restored.query('SELECT * FROM sessions')).rows.length, 0);
    assert.equal((await restored.query('SELECT * FROM facts')).rows.length, 2);
  });
});
