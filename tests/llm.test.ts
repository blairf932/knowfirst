import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { Snapshot } from '../lib/domain';

const temp = await mkdtemp(path.join(os.tmpdir(), 'frontier-llm-'));
process.env.PGLITE_DIR = temp;
delete process.env.DATABASE_URL;
process.env.LLM_PROVIDER = 'deepseek';
process.env.LLM_API_KEY = 'test-key-never-transmitted';
process.env.LLM_MAX_CALLS_PER_DAY = '100';
process.env.LLM_DAILY_BUDGET_USD = '1';
process.env.LLM_USER_DAILY_BUDGET_USD = '1';
process.env.APP_ORIGIN = 'http://127.0.0.1:3100';

const { database, closeDatabase } = await import('../lib/db');
const { registry } = await import('../lib/llm/provider');
const { groundedOutputSchema, groundedTask } = await import('../lib/llm/tasks');
const { createSession, sessionCookie } = await import('../lib/auth');
const { NextRequest } = await import('next/server');
const { POST } = await import('../app/api/[...path]/route');
const originalProvider = registry.get('deepseek');
const now = new Date().toISOString();
const evidence = {
  id: 'fact-1',
  entity: 'mem0',
  predicate: 'license',
  value: 'Apache-2.0',
  source: 'github-mem0',
  verified_at: now,
};
const claim = { fact_id: evidence.id, predicate: evidence.predicate, value: evidence.value };
const validOutput = () => ({
  kind: 'ANALYSIS' as const,
  summary: '证据声明该项目采用 Apache-2.0 许可证。',
  citations: [evidence.id],
  claims: [claim],
});
const data: Snapshot = {
  entities: [],
  sources: [],
  facts: [
    {
      id: evidence.id,
      entity_id: evidence.entity,
      predicate: evidence.predicate,
      value: evidence.value,
      source_id: evidence.source,
      kind: 'FACT',
      confidence: 0.95,
      discovered_at: now,
      published_at: null,
      valid_from: now,
      valid_until: null,
      last_verified_at: now,
      claim_id: 'claim-1',
      verification_status: 'CLAIM_VERIFIED',
    },
  ],
  events: [],
  signals: [],
  relationships: [],
  revision: 'llm-contract-test',
};

function providerFixture(outputs: unknown[]) {
  let calls = 0;
  const prompts: string[] = [];
  registry.set('deepseek', {
    name: 'deepseek',
    generate: async (request) => {
      prompts.push(request.prompt);
      const output = outputs[Math.min(calls, outputs.length - 1)];
      calls++;
      if (output instanceof Error) throw output;
      return {
        output,
        inputTokens: 10,
        outputTokens: 5,
        estimatedCost: 0.001,
      };
    },
  });
  return { calls: () => calls, prompts };
}

test.after(async () => {
  if (originalProvider) registry.set('deepseek', originalProvider);
  await closeDatabase();
  assert.ok(temp.startsWith(os.tmpdir()) && path.basename(temp).startsWith('frontier-llm-'));
  await rm(temp, { recursive: true, force: true });
});

test('DeepSeek extraction contract and bounded repair', async (t) => {
  const db = await database();
  const userId = randomUUID();
  await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
    userId,
    `${userId}@example.test`,
    'not-login-enabled',
  ]);

  await t.test('strict schema accepts one claim and rejects zero, two, or task leakage', () => {
    const extraction = groundedOutputSchema('extraction', [evidence]);
    assert.equal(extraction.safeParse(validOutput()).success, true);
    assert.equal(extraction.safeParse({ ...validOutput(), claims: [] }).success, false);
    assert.equal(extraction.safeParse({ ...validOutput(), claims: [claim, claim] }).success, false);
    assert.equal(
      groundedOutputSchema('research', [evidence]).safeParse(validOutput()).success,
      false,
    );
    assert.equal(groundedOutputSchema('extraction', []).safeParse(validOutput()).success, false);
  });

  await t.test('valid output succeeds once and cached output keeps business status', async () => {
    const fixture = providerFixture([validOutput()]);
    const query = `valid-${randomUUID()}`;
    const first = await groundedTask(data, 'extraction', query, userId);
    assert.equal(first.status, 'SUCCESS');
    assert.equal(first.result?.claims?.length, 1);
    assert.equal(first.attemptCount, 1);
    assert.equal(first.repaired, false);
    assert.equal(first.totalEstimatedCost, 0.001);
    assert.equal(first.unrecoverable, false);
    const cached = await groundedTask(data, 'extraction', query, userId);
    assert.equal(cached.status, 'SUCCESS');
    assert.equal(cached.error, null);
    assert.equal(cached.cacheHit, true);
    assert.equal(cached.attemptCount, 1);
    assert.equal(cached.totalEstimatedCost, 0);
    assert.equal(fixture.calls(), 1);
  });

  await t.test('invalid cardinality is recorded as failure before repair', async () => {
    const fixture = providerFixture([{ ...validOutput(), claims: [claim, claim] }, validOutput()]);
    const result = await groundedTask(data, 'extraction', `invalid-${randomUUID()}`, userId);
    assert.equal(result.attempts[0].status, 'FAILED');
    assert.equal(result.attempts[0].error, 'OUTPUT_SCHEMA_INVALID');
    assert.equal(fixture.calls(), 2);
  });

  await t.test('no eligible evidence cannot produce a successful extraction', async () => {
    const fixture = providerFixture([validOutput(), validOutput()]);
    const result = await groundedTask(
      { ...data, facts: [] },
      'extraction',
      `no-evidence-${randomUUID()}`,
      userId,
    );
    assert.equal(result.status, 'FAILED');
    assert.equal(result.result, null);
    assert.equal(result.attemptCount, 2);
    assert.equal(result.repaired, false);
    assert.equal(result.unrecoverable, true);
    assert.equal(fixture.calls(), 2);
  });

  await t.test('repair succeeds once with one request id and both costs', async () => {
    const fixture = providerFixture([{ ...validOutput(), claims: [claim, claim] }, validOutput()]);
    const query = `repaired-${randomUUID()}`;
    const result = await groundedTask(data, 'extraction', query, userId);
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.result?.claims?.length, 1);
    assert.equal(result.repaired, true);
    assert.equal(result.unrecoverable, false);
    assert.equal(result.attemptCount, 2);
    assert.equal(result.totalEstimatedCost, 0.002);
    assert.deepEqual(
      result.attempts.map((attempt) => [attempt.status, attempt.error]),
      [
        ['FAILED', 'OUTPUT_SCHEMA_INVALID'],
        ['SUCCESS', null],
      ],
    );
    assert.match(fixture.prompts[1], /OUTPUT_SCHEMA_INVALID/);
    assert.match(fixture.prompts[1], /exactly ONE/);
    const ledger = (
      await db.query<{ id: string; status: string; estimated_cost: string }>(
        'SELECT id,status,estimated_cost FROM llm_usage WHERE request_id=$1',
        [result.requestId],
      )
    ).rows;
    assert.equal(ledger.length, 2);
    assert.deepEqual(
      new Set(ledger.map((row) => row.id)),
      new Set(result.attempts.map((a) => a.usageId)),
    );
    assert.equal(
      ledger.reduce((total, row) => total + Number(row.estimated_cost), 0),
      result.totalEstimatedCost,
    );
    const cached = await groundedTask(data, 'extraction', query, userId);
    assert.equal(cached.status, 'SUCCESS');
    assert.equal(cached.cacheHit, true);
    assert.equal(cached.attemptCount, 1);
    assert.equal(cached.totalEstimatedCost, 0);
    assert.equal(fixture.calls(), 2);
  });

  await t.test(
    'unrecoverable JSON and schema failures stop after two charged attempts',
    async () => {
      const fixture = providerFixture(['not-json', { ...validOutput(), claims: [claim, claim] }]);
      const result = await groundedTask(
        data,
        'extraction',
        `unrecoverable-${randomUUID()}`,
        userId,
      );
      assert.equal(result.status, 'FAILED');
      assert.equal(result.result, null);
      assert.equal(result.repaired, false);
      assert.equal(result.unrecoverable, true);
      assert.equal(result.attemptCount, 2);
      assert.equal(result.totalEstimatedCost, 0.002);
      assert.deepEqual(
        result.attempts.map((attempt) => attempt.error),
        ['OUTPUT_JSON_INVALID', 'OUTPUT_SCHEMA_INVALID'],
      );
      assert.equal(fixture.calls(), 2);
      assert.equal(
        (await db.query('SELECT id FROM llm_usage WHERE request_id=$1', [result.requestId])).rows
          .length,
        2,
      );
    },
  );

  await t.test('provider failures are not retried as output repair', async () => {
    const fixture = providerFixture([new Error('upstream unavailable')]);
    const result = await groundedTask(data, 'extraction', `outage-${randomUUID()}`, userId);
    assert.equal(result.status, 'FAILED');
    assert.equal(result.error, 'MODEL_OR_VALIDATION_FAILED');
    assert.equal(result.attemptCount, 1);
    assert.equal(result.totalEstimatedCost, null);
    assert.equal(result.unrecoverable, false);
    assert.equal(fixture.calls(), 1);
  });

  await t.test('HTTP 200 remains a failed business result after unrecoverable output', async () => {
    const fixture = providerFixture([
      { ...validOutput(), claims: [claim, claim] },
      { ...validOutput(), claims: [claim, claim] },
    ]);
    const token = await createSession(userId);
    const response = await POST(
      new NextRequest('http://127.0.0.1:3100/api/llm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${sessionCookie}=${token}`,
          Origin: 'http://127.0.0.1:3100',
        },
        body: JSON.stringify({
          task: 'extraction',
          query: `api-invalid-${randomUUID()}`,
        }),
      }),
      { params: Promise.resolve({ path: ['llm'] }) },
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'FAILED');
    assert.equal(body.error, 'OUTPUT_SCHEMA_INVALID');
    assert.equal(body.result, null);
    assert.equal(body.attemptCount, 2);
    assert.equal(body.unrecoverable, true);
    assert.equal(fixture.calls(), 2);
  });
});
