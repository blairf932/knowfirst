// Test-only collection harness. Never imported by the application or standalone server.
// Controlled responses exercise the real adapters and persistence, never online verification.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { database, closeDatabase } from '../lib/db';
import { seed } from '../lib/seed';
import { adapters } from '../lib/adapters';
import { persistCollection } from '../lib/ingestion';
import { snapshot } from '../lib/knowledge';
import { buildDecision } from '../lib/intelligence';
import { emptyContext, type Source } from '../lib/domain';
const mode = process.argv[2];
assert.ok(['controlled-success', 'controlled-rate-limit', 'live'].includes(mode));
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, '127.0.0.1');
assert.ok(['frontier_acceptance_v011', 'frontier_restore_v011'].includes(url.pathname.slice(1)));
assert.equal(process.env.GITHUB_TOKEN || '', '');
assert.equal(process.env.LLM_API_KEY || '', '');
const nativeFetch = globalThis.fetch;
const githubQuota: Record<string, unknown>[] = [];
if (mode === 'live')
  globalThis.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);
    if (new URL(String(input)).hostname === 'api.github.com')
      githubQuota.push({
        path: new URL(String(input)).pathname,
        httpStatus: response.status,
        limit: response.headers.get('x-ratelimit-limit'),
        remaining: response.headers.get('x-ratelimit-remaining'),
        reset: response.headers.get('x-ratelimit-reset'),
        retryAfter: response.headers.get('retry-after'),
        fetchedAt: new Date().toISOString(),
        authenticated: false,
      });
    return response;
  };
if (mode !== 'live')
  globalThis.fetch = async (input) => {
    const u = new URL(String(input));
    if (u.hostname === 'api.github.com') {
      if (mode === 'controlled-rate-limit')
        return new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
      if (u.pathname.endsWith('/readme'))
        return Response.json({
          content: Buffer.from('TEST FIXTURE: long-term memory').toString('base64'),
          encoding: 'base64',
          sha: 'test-fixture-not-a-real-commit',
          html_url: 'https://github.com/mem0ai/mem0',
        });
      return Response.json({
        full_name: 'mem0ai/mem0',
        html_url: 'https://github.com/mem0ai/mem0',
        description: 'TEST FIXTURE ONLY',
        stargazers_count: 1,
        forks_count: 1,
        open_issues_count: 0,
        archived: false,
        pushed_at: null,
        license: { spdx_id: 'Apache-2.0' },
        default_branch: 'main',
      });
    }
    if (u.hostname === 'docs.mem0.ai')
      return new Response('TEST FIXTURE: OpenClaw @mem0/openclaw-mem0');
    if (u.hostname === 'registry.npmjs.org')
      return Response.json({
        name: '@mem0/openclaw-mem0',
        version: '0.0.0-test-fixture',
        license: 'Apache-2.0',
      });
    throw new Error('Unexpected fixture request');
  };
try {
  await seed();
  const db = await database();
  const sources = (
    await db.query<Source>(
      "SELECT * FROM sources WHERE id IN ('github-mem0','readme-mem0','integration-mem0','npm-mem0') ORDER BY id",
    )
  ).rows;
  assert.equal(sources.length, 4);
  const results = [];
  for (const source of sources) {
    let collected;
    try {
      collected = await adapters.get(source.adapter)!.collect(source);
    } catch (e) {
      collected = {
        status: (e as { status?: 'RATE_LIMITED' | 'ERROR' }).status || 'ERROR',
        metadata: {},
        error: e instanceof Error ? e.message : 'Collection failed',
      };
    }
    await db.transaction((tx) => persistCollection(tx, source, collected));
    results.push({ id: source.id, status: collected.status });
  }
  const data = await snapshot();
  const decision = buildDecision(data, '我想给 OpenClaw 增加长期记忆', emptyContext).decision;
  if (mode === 'controlled-success') assert.equal(decision, 'INTEGRATE');
  if (mode === 'controlled-rate-limit') assert.equal(decision, 'WAIT');
  const result = {
    mode,
    provenance: mode === 'live' ? 'LIVE_EXTERNAL' : 'SIMULATED_SOURCE_RESPONSES_REAL_ADAPTER_DB',
    decision,
    results,
    ...(mode === 'live' ? { githubQuota } : {}),
  };
  await writeFile(`.cache/sources-${mode}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  globalThis.fetch = nativeFetch;
  await closeDatabase();
}
