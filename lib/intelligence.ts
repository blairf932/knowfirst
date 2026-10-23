import {
  type Snapshot,
  type UserContext,
  type Entity,
  type Source,
  freshness,
  ttlHours,
} from './domain';
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s_\-]+/g, ' ')
    .trim();
export function detectIntent(q: string) {
  return /\bvs\.?\b|对比|比较/i.test(q)
    ? 'COMPARE'
    : /我要|我想|开发|增加|搭建|接入|build|integrate|implement|buy|给.+做/i.test(q)
      ? 'BUILD'
      : 'CONCEPT';
}
export function searchEntities(data: Snapshot, q: string) {
  const n = normalize(q);
  if (!n) return [];
  return data.entities
    .filter((e) => e.kind === 'Concept' || e.kind === 'Tool')
    .map((e) => {
      const terms = [e.name, e.slug, ...e.aliases].map(normalize);
      const score = Math.max(
        ...terms.map((t) => (n === t ? 100 : n.includes(t) ? 80 : t.includes(n) ? 60 : 0)),
      );
      return { entity: e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.entity.name.localeCompare(b.entity.name));
}
export function relevant(e: Entity, context: UserContext, data: Snapshot) {
  const input = normalize([...context.uses, ...context.interests, context.building].join(' '));
  if (!input) return { level: 'LOW', reason: '设置正在使用和研究的技术后计算相关度。', score: 0 };
  const terms = [e.name, e.slug, ...e.aliases];
  const direct = terms.some((t) => input.includes(normalize(t)));
  const relatedIds = data.relationships
    .filter((r) => r.from_id === e.id || r.to_id === e.id)
    .map((r) => (r.from_id === e.id ? r.to_id : r.from_id));
  const related = data.entities
    .filter((x) => relatedIds.includes(x.id))
    .some((x) => [x.name, x.slug, ...x.aliases].some((t) => input.includes(normalize(t))));
  return {
    level: direct ? 'HIGH' : related ? 'MEDIUM' : 'LOW',
    reason: direct
      ? '匹配你的技术档案关键词。'
      : related
        ? '与你关注的概念或工具存在技术关系（相关度为 ANALYSIS）。'
        : '尚未发现与你的档案有直接关联。',
    score: direct ? 90 : related ? 60 : 10,
  };
}
export function dailyFive(
  data: Snapshot,
  context: UserContext,
  date = new Date().toISOString().slice(0, 10),
) {
  const offset = Array.from(date).reduce((s, c) => s + c.charCodeAt(0), 0);
  return data.entities
    .filter((e) => e.kind === 'Concept')
    .map((e, i) => ({
      entity: e,
      relevance: relevant(e, context, data),
      rank:
        relevant(e, context, data).score +
        (context.learned.includes(e.id) ? -100 : 0) +
        ((i + offset) % 17) / 20,
    }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 5);
}
export function fact(data: Snapshot, id: string, predicate: string) {
  return data.facts.find((f) => f.entity_id === id && f.predicate === predicate);
}
export function effectiveStatus(s: Source, now = Date.now()) {
  return (s.status === 'AVAILABLE' || s.status === 'PARTIAL') &&
    freshness(s.retrieved_at, s.adapter === 'releases' ? ttlHours.changes : ttlHours.tool, now) ===
      0
    ? 'STALE'
    : s.status;
}
export function toolEvidence(data: Snapshot, e: Entity) {
  const sources = data.sources.filter((s) => s.entity_id === e.id);
  const fs = data.facts.filter((f) => f.entity_id === e.id);
  const last =
    fs
      .map((f) => f.last_verified_at)
      .sort()
      .at(-1) ?? null;
  return {
    sources,
    facts: fs,
    lastVerified: last,
    freshness: freshness(last),
    confidence: fs.length ? Math.min(...fs.map((f) => f.confidence)) : null,
    status: fs.length ? (freshness(last) === 0 ? 'STALE' : 'PARTIAL') : 'UNAVAILABLE',
  };
}
export function trend(data: Snapshot, id: string) {
  const stars = data.signals
    .filter((s) => s.entity_id === id && s.metric === 'github_stars' && s.value !== null)
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const first = stars[0],
    last = stars.at(-1);
  if (!first || !last || Date.parse(last.observed_at) - Date.parse(first.observed_at) < 86400000)
    return {
      direction: 'UNCERTAIN',
      status: 'UNAVAILABLE',
      velocity: null,
      reason: '至少需要相隔 24 小时的独立观测；单次 Stars 数量不能证明趋势。',
    };
  const days = (Date.parse(last.observed_at) - Date.parse(first.observed_at)) / 86400000;
  const velocity = (last.value! - first.value!) / days;
  return {
    direction: 'UNCERTAIN',
    status: freshness(last.observed_at) === 0 ? 'STALE' : 'PARTIAL',
    velocity,
    reason: '已计算 Stars/天；综合趋势还需要贡献者、发布与采用等独立信号。',
  };
}
export function usableFact(data: Snapshot, id: string, predicate: string) {
  const f = fact(data, id, predicate);
  if (!f || freshness(f.last_verified_at) === 0) return undefined;
  const source = data.sources.find((s) => s.id === f.source_id);
  return source && ['AVAILABLE', 'PARTIAL'].includes(effectiveStatus(source)) ? f : undefined;
}
export function buildDecision(data: Snapshot, q: string, context: UserContext) {
  const matches = searchEntities(data, q);
  const ids = new Set(matches.map((x) => x.entity.id));
  const memory = /记忆|memory/i.test(q);
  if (memory) ids.add('long-term-memory');
  const tools = data.entities.filter(
    (e) =>
      e.kind === 'Tool' &&
      (ids.has(e.id) || data.relationships.some((r) => r.from_id === e.id && ids.has(r.to_id))),
  );
  const requiresOpenClaw = /openclaw/i.test(q);
  const hardConstraints = [
    ...(/隐私|private|privacy/i.test(q) ? ['privacy'] : []),
    ...(/离线|offline/i.test(q) ? ['offline'] : []),
    ...(/windows/i.test(q) ? ['windows'] : []),
    ...(/免费|预算|价格|budget|price|free/i.test(q) ? ['pricing'] : []),
  ];
  const requirements = [
    ...(memory ? ['memory'] : []),
    ...(/mcp/i.test(q) ? ['mcp'] : []),
    ...(/时间|temporal/i.test(q) ? ['temporal'] : []),
    ...(/本地|self.host/i.test(q) ? ['self_host'] : []),
    ...hardConstraints,
  ];
  const candidates = tools
    .filter((e) => e.slug !== 'openclaw')
    .map((e) => {
      const evidence = toolEvidence(data, e);
      const matched = requirements.filter((r) => usableFact(data, e.id, `readme_mentions_${r}`));
      const integration = usableFact(data, e.id, 'documented_integration_openclaw');
      const plugin = integration?.value as { package: string; url: string } | undefined;
      const lic = usableFact(data, e.id, requiresOpenClaw ? 'plugin_license' : 'license')?.value;
      const licenseAllowed =
        typeof lic === 'string' &&
        ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC'].includes(lic);
      const archived = usableFact(data, e.id, 'archived')?.value;
      const deprecation = usableFact(data, e.id, 'plugin_deprecation')?.value;
      const coverage = requirements.length
        ? Math.round((matched.length / requirements.length) * 100)
        : null;
      return {
        entity: e,
        matched,
        coverage,
        requirements,
        plugin,
        compatibility: requiresOpenClaw ? (plugin ? 'DECLARED' : 'UNAVAILABLE') : 'PARTIAL',
        license: lic ?? 'UNKNOWN',
        licenseReview: !licenseAllowed,
        maintenance:
          archived === true ? 'ARCHIVED' : archived === false ? 'NOT_ARCHIVED' : 'UNAVAILABLE',
        deprecated: requiresOpenClaw && deprecation !== 'NOT_MARKED_DEPRECATED',
        maturity: 'UNAVAILABLE',
        cost: 'UNAVAILABLE',
        privacy: 'UNAVAILABLE',
        lockIn: 'UNAVAILABLE',
        integrationComplexity: 'UNAVAILABLE',
        evidence,
      };
    })
    .sort((a, b) => (b.coverage ?? -1) - (a.coverage ?? -1));
  const viable = candidates.find(
    (c) =>
      c.coverage !== null &&
      c.coverage >= 80 &&
      !c.licenseReview &&
      !c.deprecated &&
      c.maintenance === 'NOT_ARCHIVED' &&
      c.evidence.status !== 'STALE' &&
      (!requiresOpenClaw || c.plugin) &&
      hardConstraints.every((r) => c.matched.includes(r)),
  );
  const sufficient = !!viable;
  const documented = candidates.some((c) => c.plugin);
  return {
    kind: 'ANALYSIS',
    query: q,
    intent: 'BUILD',
    decision: sufficient ? 'INTEGRATE' : 'WAIT',
    buildNecessityScore: sufficient ? 100 - viable.coverage! : null,
    confidence: sufficient ? 'MEDIUM' : 'LOW',
    requirements,
    candidates,
    reason: sufficient
      ? requiresOpenClaw
        ? '官方文档已列出 OpenClaw 记忆插件，发布包许可证已核查。建议先集成验证，不建议立即从零开发；实际版本兼容性、成本与质量仍需测试。'
        : '已有项目的 README 覆盖至少 80% 的已识别能力关键词。不建议从零开发；先做集成验证。覆盖率不代表质量或生产适配。'
      : requiresOpenClaw
        ? documented
          ? '找到了官方 OpenClaw 插件，但许可、部署条件或明确约束仍有未解决项。保留 WAIT，先核查这些缺口。'
          : '找到了记忆候选方案，但缺少当前可用的 OpenClaw 集成证据。先验证兼容性，再决定是否自建。'
        : '证据不足以给出可靠的自建必要性分数。请明确需求并核查候选方案。',
    method:
      'v0.1：覆盖率 = 当前来源中有证据的能力关键词数 ÷ 已识别能力数；自建分数 = 100 − 覆盖率，仅作初筛。插件需要独立文档与包许可；明确的隐私、离线、系统和预算约束未核查时保留 WAIT。',
    personal: matches[0] ? relevant(matches[0].entity, context, data) : null,
  };
}
