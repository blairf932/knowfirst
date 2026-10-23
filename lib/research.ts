import { createHash, randomUUID } from 'node:crypto';
import { database } from './db';
import { detectIntent, searchEntities, relevant, toolEvidence, trend } from './knowledge';
import type { Snapshot, UserContext } from './domain';
import { ttlHours } from './domain';
export async function research(data: Snapshot, q: string, context: UserContext, userId?: string) {
  const db = await database();
  const intent = detectIntent(q);
  const key = createHash('sha256')
    .update(q.trim().toLowerCase() + data.revision)
    .digest('hex');
  const cached = (
    await db.query<{ result: { matches: ReturnType<typeof searchEntities> } }>(
      'SELECT result FROM card_cache WHERE cache_key=$1 AND expires_at>now()',
      [key],
    )
  ).rows[0];
  const matches = cached?.result.matches ?? searchEntities(data, q);
  const stages = [
    ['Intent Detection', 'AVAILABLE', '规则分类，保留原始问题'],
    ['Search', matches.length ? 'AVAILABLE' : 'UNAVAILABLE', '本地已验证目录及中英文别名检索'],
    [
      'Source Collection',
      data.sources.some((s) => s.retrieved_at) ? 'PARTIAL' : 'UNAVAILABLE',
      '复用 Radar 抓取快照；按需刷新由独立连接器执行',
    ],
    ['Source Ranking', 'AVAILABLE', 'Tier S → A → B → C'],
    ['Entity Resolution', 'AVAILABLE', '稳定实体 ID 与审核别名'],
    ['Fact Extraction', 'PARTIAL', 'GitHub JSON 与 README 限定短语；开放文本抽取未启用'],
    ['Deduplication', 'AVAILABLE', '事实值比较、当前事实唯一约束'],
    ['Evidence Validation', 'AVAILABLE', '来源外键、结构校验、Tier C 限制'],
    ['Relationship Extraction', 'PARTIAL', '已审核分类关系标记 ANALYSIS；自动关系抽取未启用'],
    ['Change Detection', 'AVAILABLE', '追加版本和观测变化事件'],
    ['Trend Signals', 'PARTIAL', '实际观测计算；不足 24 小时不生成速度'],
    [
      'Card Generation',
      matches.length ? 'AVAILABLE' : 'UNAVAILABLE',
      '从实体、事实与来源确定性组装',
    ],
    ['Personal Relevance', 'AVAILABLE', '用户关键词与分类关系规则'],
    ['Persist', 'AVAILABLE', '研究记录与共享证据缓存'],
  ].map(([stage, status, detail]) => ({ stage, status, detail }));
  if (!cached)
    await db.query(
      "INSERT INTO card_cache(cache_key,result,expires_at) VALUES($1,$2,now()+($3::text||' hours')::interval) ON CONFLICT(cache_key) DO UPDATE SET result=excluded.result,expires_at=excluded.expires_at",
      [key, JSON.stringify({ matches }), Math.min(ttlHours.evergreen, ttlHours.tool)],
    );
  const id = randomUUID();
  if (userId)
    await db.query(
      'INSERT INTO research_runs(id,user_id,query,intent,status,stages) VALUES($1,$2,$3,$4,$5,$6)',
      [id, userId, q, intent, matches.length ? 'PARTIAL' : 'UNAVAILABLE', JSON.stringify(stages)],
    );
  return {
    id,
    intent,
    status: matches.length ? 'PARTIAL' : 'UNAVAILABLE',
    cacheHit: !!cached,
    matches: matches.map((m) => ({ ...m, relevance: relevant(m.entity, context, data) })),
    stages,
  };
}
export function frontierCard(data: Snapshot, slug: string, context: UserContext) {
  const entity = data.entities.find((e) => e.slug === slug);
  if (!entity) return null;
  const related = data.relationships
    .filter((r) => r.to_id === entity.id)
    .map((r) => data.entities.find((e) => e.id === r.from_id))
    .filter((e) => e?.kind === 'Tool');
  return {
    entity,
    kind: 'ANALYSIS',
    ...toolEvidence(data, entity),
    tools: related,
    trend: trend(data, entity.id),
    personal: relevant(entity, context, data),
    events: data.events.filter(
      (e) => e.entity_id === entity.id || related.some((t) => t?.id === e.entity_id),
    ),
    asOf: new Date().toISOString(),
  };
}
