import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const temp = await mkdtemp(path.join(os.tmpdir(), 'frontier-hardening-'));
process.env.PGLITE_DIR = temp;
process.env.ERASURE_LEDGER_PATH = path.join(temp, 'erasure.jsonl');
if (process.env.TEST_HARDENING_URL) {
  if (!new URL(process.env.TEST_HARDENING_URL).pathname.endsWith('/frontier_hardening_v011'))
    throw new Error('Unsafe test database');
  process.env.DATABASE_URL = process.env.TEST_HARDENING_URL;
} else delete process.env.DATABASE_URL;
const { database, closeDatabase } = await import('../lib/db');
const { seed } = await import('../lib/seed');
const { persistCollection } = await import('../lib/ingestion');
const { enqueueSources, claimJob, workOne } = await import('../lib/scheduler');
const { deleteAccount, applyErasureLedger, erasureDigest } = await import('../lib/privacy');
const { registry, runModel } = await import('../lib/llm/provider');
test.after(async () => {
  await closeDatabase();
  assert.ok(temp.startsWith(os.tmpdir()) && path.basename(temp).startsWith('frontier-hardening-'));
  await rm(temp, { recursive: true, force: true });
});
test('v0.1.1 evidence, durable scheduling, privacy and cost guardrails', async (t) => {
  await seed();
  let db = await database();
  const source = (
    await db.query<import('../lib/domain').Source>('SELECT * FROM sources WHERE id=$1', [
      'github-mem0',
    ])
  ).rows[0];
  await t.test('schema parity, indexes and vector-free SQL', async () => {
    const columns = (
      await db.query(
        "SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
      )
    ).rows;
    const indexes = (
      await db.query(
        "SELECT tablename,indexname FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
      )
    ).rows;
    const schema = JSON.stringify({ columns, indexes });
    if (process.env.TEST_HARDENING_URL)
      assert.equal(schema, await readFile('.cache/pglite-schema.json', 'utf8'));
    else {
      await mkdir('.cache', { recursive: true });
      await writeFile('.cache/pglite-schema.json', schema);
    }
    assert.equal(
      (await db.query("SELECT 1 FROM pg_extension WHERE extname='vector'")).rows.length,
      0,
    );
  });
  await t.test('nested transactions reject without escaping outer rollback', async () => {
    await assert.rejects(
      () =>
        db.transaction(async (tx) => {
          await tx.query("INSERT INTO rate_limits VALUES('nested',1,now())");
          await tx.transaction(async (inner) => {
            await inner.query("INSERT INTO rate_limits VALUES('escaped',1,now())");
          });
        }),
      /Nested transaction/,
    );
    assert.equal(
      (await db.query("SELECT * FROM rate_limits WHERE bucket IN ('nested','escaped')")).rows
        .length,
      0,
    );
  });
  await t.test(
    'URL-only collections create no fact; locator-less claim cannot become HIGH',
    async () => {
      await db.transaction((tx) =>
        persistCollection(tx, source, { status: 'PARTIAL', metadata: { title: 'reachable' } }),
      );
      assert.equal((await db.query('SELECT * FROM facts')).rows.length, 0);
      await db.transaction((tx) =>
        persistCollection(tx, source, {
          status: 'AVAILABLE',
          metadata: {},
          facts: [{ predicate: 'license', value: 'MIT', confidence: 0.99 }],
        }),
      );
      const f = (
        await db.query<{ confidence: number; verification_status: string }>('SELECT * FROM facts')
      ).rows[0];
      assert.equal(f.confidence, 0.84);
      assert.equal(f.verification_status, 'SOURCE_VERIFIED');
    },
  );
  await t.test(
    '20 concurrent writes preserve one current fact and minimal immutable claims',
    async () => {
      await Promise.all(
        Array.from({ length: 20 }, () =>
          db.transaction((tx) =>
            persistCollection(tx, source, {
              status: 'AVAILABLE',
              metadata: {},
              facts: [
                {
                  predicate: 'license',
                  value: 'MIT',
                  confidence: 0.95,
                  locator: { format: 'json-pointer', path: '/license/spdx_id' },
                },
              ],
            }),
          ),
        ),
      );
      assert.equal(
        (await db.query('SELECT * FROM facts WHERE valid_until IS NULL')).rows.length,
        1,
      );
      const f = (await db.query<{ confidence: number; claim_id: string }>('SELECT * FROM facts'))
        .rows[0];
      assert.equal(f.confidence, 0.95);
      assert.ok(f.claim_id);
      await assert.rejects(
        () => db.query('UPDATE facts SET value=\'"GPL-3.0"\'::jsonb'),
        /provenance mismatch/,
      );
      await assert.rejects(
        () => db.query('UPDATE evidence_claims SET confidence=1'),
        /append-only/,
      );
      await assert.rejects(() => db.query('UPDATE facts SET claim_id=NULL'), /high_requires_claim/);
    },
  );
  await t.test('queue deduplicates and two workers cannot fetch the same source', async () => {
    const jobs = await Promise.all(
      Array.from({ length: 10 }, () => enqueueSources(source.id, true)),
    );
    assert.equal(jobs.flat().length, 1);
    let count = 0;
    await Promise.all([
      workOne(async () => {
        count++;
        return { status: 'AVAILABLE', metadata: {} };
      }),
      workOne(async () => {
        count++;
        return { status: 'AVAILABLE', metadata: {} };
      }),
    ]);
    assert.equal(count, 1);
  });
  let reconnected = false;
  await t.test(
    'committed running job survives reconnect, recovers lease and bounds retries',
    async () => {
      const [id] = await enqueueSources(source.id, true);
      const claimed = await claimJob();
      assert.equal(claimed?.id, id);
      await closeDatabase();
      db = await database();
      reconnected = true;
      assert.equal(
        (await db.query<{ status: string }>('SELECT status FROM research_jobs WHERE id=$1', [id]))
          .rows[0].status,
        'RUNNING',
      );
      await db.query("UPDATE research_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [
        id,
      ]);
      const next = await claimJob();
      assert.equal(next?.id, id);
      assert.equal(next?.attempts, 2);
      await db.query(
        "UPDATE research_jobs SET lease_until=now()-interval '1 second',attempts=3 WHERE id=$1",
        [id],
      );
      assert.equal(await claimJob(), undefined);
      assert.equal(
        (await db.query<{ status: string }>('SELECT status FROM research_jobs WHERE id=$1', [id]))
          .rows[0].status,
        'FAILED',
      );
    },
  );
  // t.test records failure without throwing; stop dependent work after failed reconnect.
  if (!reconnected) throw new Error('Reconnect failed; dependent checks cannot continue');
  const user = randomUUID();
  await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
    user,
    `${user}@example.test`,
    'test-not-a-password',
  ]);
  await t.test(
    'model ledger: real adapter boundary, cache, invalid schema, outage and budget',
    async () => {
      process.env.LLM_PROVIDER = 'deepseek';
      process.env.LLM_API_KEY = 'test-key-never-transmitted';
      process.env.LLM_MAX_CALLS_PER_DAY = '8';
      process.env.LLM_DAILY_BUDGET_USD = '0.1';
      process.env.LLM_USER_DAILY_BUDGET_USD = '0.03';
      let calls = 0;
      registry.set('deepseek', {
        name: 'deepseek',
        generate: async () => {
          calls++;
          return {
            output: { text: 'grounded' },
            inputTokens: 20,
            outputTokens: 10,
            estimatedCost: 0.00002,
          };
        },
      });
      const request = {
        model: 'deepseek-v4-flash',
        task: 'research' as const,
        prompt: 'fixture only',
        maxOutputTokens: 100,
        cardId: 'mem0',
      };
      const a = await runModel('deepseek', request, z.object({ text: z.string() }), user, null);
      assert.equal(a.status, 'SUCCESS');
      const b = await runModel('deepseek', request, z.object({ text: z.string() }), user, null);
      assert.equal(b.cacheHit, true);
      assert.equal(calls, 1);
      const invalid = await runModel(
        'deepseek',
        { ...request, prompt: 'invalid schema' },
        z.object({ required: z.number() }),
        user,
        null,
      );
      assert.equal(invalid.status, 'FAILED');
      assert.equal(invalid.estimatedCost, 0.00002);
      registry.set('deepseek', {
        name: 'deepseek',
        generate: async () => {
          throw new Error('secret upstream response');
        },
      });
      const failed = await runModel(
        'deepseek',
        { ...request, prompt: 'outage' },
        z.object({ text: z.string() }),
        user,
        null,
      );
      assert.equal(failed.status, 'FAILED');
      assert.equal(failed.estimatedCost, null);
      process.env.LLM_DAILY_BUDGET_USD = '0.000001';
      const blocked = await runModel(
        'deepseek',
        { ...request, prompt: 'budget' },
        z.object({ text: z.string() }),
        user,
        null,
      );
      assert.equal(blocked.status, 'BLOCKED');
      assert.equal((await db.query('SELECT * FROM entities')).rows.length, 38);
    },
  );
  await t.test(
    'account deletion cascades personal data and an old restore cannot resurrect it',
    async () => {
      await db.query('INSERT INTO user_contexts(user_id,context) VALUES($1,$2)', [
        user,
        JSON.stringify({ building: 'private' }),
      ]);
      await db.query("INSERT INTO sessions VALUES('private-session',$1,now()+interval '1 day')", [
        user,
      ]);
      await db.query(
        "INSERT INTO research_runs(id,user_id,query,intent,status,stages) VALUES($1,$2,'private query','CONCEPT','PARTIAL','[]')",
        [randomUUID(), user],
      );
      await deleteAccount(user);
      for (const table of [
        'users',
        'sessions',
        'user_contexts',
        'research_runs',
        'llm_usage',
        'llm_cache',
      ])
        assert.equal(
          (
            await db.query(
              `SELECT * FROM ${table} WHERE ${table === 'users' ? 'id' : 'user_id'}=$1`,
              [user],
            )
          ).rows.length,
          0,
        );
      assert.ok(
        (await readFile(process.env.ERASURE_LEDGER_PATH!, 'utf8')).includes(erasureDigest(user)),
      );
      // Simulate an older backup's user rows being loaded within a restore transaction.
      await db.transaction(async (tx) => {
        await tx.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
          user,
          `${user}@example.test`,
          'restored',
        ]);
        await applyErasureLedger(tx);
      });
      assert.equal((await db.query('SELECT * FROM users WHERE id=$1', [user])).rows.length, 0);
    },
  );
});
