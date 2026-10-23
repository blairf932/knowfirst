import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectIntent,
  searchEntities,
  trend,
  buildDecision,
  dailyFive,
  relevant,
} from '../lib/intelligence';
import {
  freshness,
  contextSchema,
  credentialsSchema,
  emptyContext,
  type Snapshot,
} from '../lib/domain';
import { allEntities } from '../lib/catalog';
const data: Snapshot = {
  entities: allEntities,
  sources: [],
  facts: [],
  events: [],
  signals: [],
  relationships: [
    {
      from_id: 'mem0',
      to_id: 'long-term-memory',
      predicate: 'CATEGORY',
      kind: 'ANALYSIS',
      source_id: null,
    },
  ],
  revision: '',
};
test('Chinese concept and build queries take different paths', () => {
  assert.equal(detectIntent('长期记忆'), 'CONCEPT');
  assert.equal(detectIntent('我想给 OpenClaw 增加长期记忆'), 'BUILD');
  assert.equal(detectIntent('Mem0 vs Graphiti'), 'COMPARE');
});
test('Aliases resolve Chinese to canonical concept', () => {
  assert.equal(searchEntities(data, '长期记忆')[0].entity.slug, 'long-term-memory');
  assert.equal(searchEntities(data, 'invented-nonexistent-topic').length, 0);
});
test('No observation is not zero freshness', () => {
  assert.equal(freshness(null), null);
  assert.equal(freshness('2020-01-01', 24, Date.parse('2026-01-01')), 0);
});
test('Single real observation does not invent growth or trend', () => {
  const d = {
    ...data,
    signals: [
      {
        entity_id: 'mem0',
        metric: 'github_stars',
        value: 123,
        unit: 'stars',
        source_id: 's',
        status: 'AVAILABLE' as const,
        observed_at: '2026-09-01',
      },
    ],
  };
  assert.equal(trend(d, 'mem0').velocity, null);
  assert.equal(trend(d, 'mem0').direction, 'UNCERTAIN');
});
test('Two time-separated observations compute actual stars/day only', () => {
  const d = {
    ...data,
    signals: [
      {
        entity_id: 'mem0',
        metric: 'github_stars',
        value: 100,
        unit: 'stars',
        source_id: 's',
        status: 'AVAILABLE' as const,
        observed_at: '2026-09-01',
      },
      {
        entity_id: 'mem0',
        metric: 'github_stars',
        value: 120,
        unit: 'stars',
        source_id: 's',
        status: 'AVAILABLE' as const,
        observed_at: '2026-09-03',
      },
    ],
  };
  assert.equal(trend(d, 'mem0').velocity, 10);
  assert.equal(trend(d, 'mem0').direction, 'UNCERTAIN');
});
test('OpenClaw missing integration evidence never becomes confident recommendation', () => {
  const d = buildDecision(data, '我想给 OpenClaw 增加长期记忆', emptyContext);
  assert.equal(d.decision, 'WAIT');
  assert.equal(d.buildNecessityScore, null);
  assert.equal(d.candidates[0].license, 'UNKNOWN');
});
test('Unknown requirements are not presented as zero coverage', () => {
  const d = buildDecision(data, 'Mem0', emptyContext);
  assert.equal(d.candidates[0].coverage, null);
});
test('Daily 5 is unique and reproducible for date and profile', () => {
  const a = dailyFive(data, emptyContext, '2026-09-04');
  assert.equal(a.length, 5);
  assert.equal(new Set(a.map((x) => x.entity.id)).size, 5);
  assert.deepEqual(a, dailyFive(data, emptyContext, '2026-09-04'));
});
test('Personal profile changes relevance and learned cards are deprioritized', () => {
  const c = { ...emptyContext, interests: ['长期记忆'], learned: ['long-term-memory'] };
  const e = allEntities.find((e) => e.id === 'long-term-memory')!;
  assert.equal(relevant(e, c, data).level, 'HIGH');
  assert.equal(relevant(e, emptyContext, data).level, 'LOW');
  assert.notEqual(dailyFive(data, c)[0].entity.id, 'long-term-memory');
});
test('Input validation rejects oversized context and short passwords', () => {
  assert.equal(
    contextSchema.safeParse({ ...emptyContext, building: 'x'.repeat(1001) }).success,
    false,
  );
  assert.equal(credentialsSchema.safeParse({ email: 'x@y.com', password: 'short' }).success, false);
});
function documentedPlugin(): Snapshot {
  const now = new Date().toISOString();
  return {
    ...data,
    sources: [
      {
        id: 'verified',
        url: 'https://docs.mem0.ai/integrations/openclaw',
        title: 'Test fixture',
        tier: 'S',
        adapter: 'integration',
        entity_id: 'mem0',
        status: 'AVAILABLE',
        retrieved_at: now,
        published_at: null,
        error: null,
        metadata: {},
      },
    ],
    facts: Object.entries({
      readme_mentions_memory: { mention: 'long-term memory' },
      documented_integration_openclaw: {
        package: '@mem0/openclaw-mem0',
        url: 'https://docs.mem0.ai/integrations/openclaw',
      },
      plugin_license: 'Apache-2.0',
      plugin_deprecation: 'NOT_MARKED_DEPRECATED',
      archived: false,
    }).map(([predicate, value]) => ({
      id: predicate,
      entity_id: 'mem0',
      predicate,
      value,
      source_id: 'verified',
      kind: 'FACT',
      confidence: 0.9,
      discovered_at: now,
      published_at: null,
      valid_from: now,
      valid_until: null,
      last_verified_at: now,
    })),
  };
}
test('Documented plugin with independent package license can enter integration validation', () => {
  const d = buildDecision(documentedPlugin(), '给 OpenClaw 做长期记忆', emptyContext);
  assert.equal(d.decision, 'INTEGRATE');
  assert.match(d.candidates[0].compatibility, /DECLARED/);
  assert.equal(d.candidates[0].plugin?.package, '@mem0/openclaw-mem0');
});
test('Failed source cannot support a current positive recommendation', () => {
  const fixture = documentedPlugin();
  fixture.sources[0].status = 'ERROR';
  assert.equal(buildDecision(fixture, '给 OpenClaw 做长期记忆', emptyContext).decision, 'WAIT');
});
test('Privacy and offline constraints are not inferred from general memory capability', () => {
  assert.equal(
    buildDecision(
      documentedPlugin(),
      '给 OpenClaw 做长期记忆，需要隐私保护和离线运行',
      emptyContext,
    ).decision,
    'WAIT',
  );
});
