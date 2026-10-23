'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useMemo } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  Search,
  Compass,
  Layers,
  Radio,
  GitCompareArrows,
  Hammer,
  BookOpen,
  Settings2,
  ExternalLink,
  Check,
  RefreshCw,
  ChevronRight,
  ShieldCheck,
  Clock,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import {
  type Snapshot,
  type UserContext,
  type Entity,
  type Fact,
  type Source,
  confidenceLabel,
  freshness,
  emptyContext,
} from '@/lib/domain';
import {
  searchEntities,
  detectIntent,
  dailyFive,
  relevant,
  toolEvidence,
  trend,
  buildDecision,
  fact,
  effectiveStatus,
} from '@/lib/intelligence';
type Props = {
  data: Snapshot;
  initialContext: UserContext;
  user: { id: string; email: string } | null;
  route: string;
  slug?: string;
  initialQuery: string;
  asOf?: string;
  modelConfigured: boolean;
};
const fmt = (d: string | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : 'UNAVAILABLE';
const display = (x: unknown): string =>
  x === null || x === undefined
    ? 'UNAVAILABLE'
    : typeof x === 'boolean'
      ? x
        ? 'Yes'
        : 'No'
      : typeof x === 'object'
        ? String(
            (x as Record<string, unknown>).mention ??
              (x as Record<string, unknown>).package ??
              JSON.stringify(x),
          )
        : String(x);
const nav = [
  ['dashboard', '工作台', Compass, '/'],
  ['radar', 'Frontier Radar', Radio, '/radar'],
  ['compare', 'Compare', GitCompareArrows, '/compare'],
  ['build', 'Build or Buy', Hammer, '/build'],
  ['sources', '证据与来源', BookOpen, '/sources'],
] as const;
function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Status({ value }: { value: string }) {
  const tone = ['AVAILABLE', 'HIGH', 'INTEGRATE'].includes(value)
    ? 'green'
    : ['ERROR', 'RATE_LIMITED', 'AVOID'].includes(value)
      ? 'red'
      : ['PARTIAL', 'STALE', 'WAIT', 'MEDIUM'].includes(value)
        ? 'amber'
        : 'neutral';
  return <Badge tone={tone}>{value}</Badge>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-dot" />
      <div>{children}</div>
    </div>
  );
}
function Out({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ExternalLink size={13} />
    </a>
  );
}
function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="meta">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function SearchBox({ initial = '', large = false }: { initial?: string; large?: boolean }) {
  return (
    <form className={`search-box ${large ? 'large' : ''}`} action="/search">
      <Search size={21} />
      <input
        name="q"
        aria-label="What do you want to understand?"
        placeholder="What do you want to understand?"
        defaultValue={initial}
        required
        maxLength={500}
      />
      <button type="submit" aria-label="搜索">
        <ArrowRight size={21} />
      </button>
    </form>
  );
}
function SourceLink({ s }: { s: Source }) {
  return (
    <div className="source-link">
      <Badge tone={s.tier === 'S' ? 'green' : 'neutral'}>TIER {s.tier}</Badge>
      <div>
        <Out href={String(s.metadata.html_url ?? s.url)}>{s.title}</Out>
        <small>
          {new URL(s.url).hostname} · {fmt(s.retrieved_at)}
        </small>
      </div>
      <Status value={effectiveStatus(s)} />
    </div>
  );
}
export default function FrontierApp({
  data,
  initialContext,
  user,
  route,
  slug,
  initialQuery,
  asOf,
  modelConfigured,
}: Props) {
  const router = useRouter();
  const [context, setContext] = useState(initialContext);
  const [sideOpen, setSideOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(30);
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [radarFilter, setRadarFilter] = useState('ALL');
  const [selected, setSelected] = useState(['mem0', 'supermemory', 'graphiti']);
  const [buildQ, setBuildQ] = useState(initialQuery || '我想给 OpenClaw 增加长期记忆');
  const [submittedBuild, setSubmittedBuild] = useState(buildQ);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [uses, setUses] = useState(context.uses.join(', '));
  const [interests, setInterests] = useState(context.interests.join(', '));
  const [building, setBuilding] = useState(context.building);
  const concepts = data.entities.filter((e) => e.kind === 'Concept');
  const tools = data.entities.filter((e) => e.kind === 'Tool');
  const entity = data.entities.find((e) => e.slug === slug);
  const verified = data.sources.filter((s) => s.retrieved_at).length;
  const currentEvents = data.events.filter(
    (e) => Date.now() - Date.parse(e.published_at) <= days * 86400000,
  );
  const personalized = useMemo(
    () =>
      data.entities
        .filter((e) => e.kind === 'Concept' || e.kind === 'Tool')
        .map((e) => ({ entity: e, ...relevant(e, context, data) }))
        .filter((x) => x.score >= 60)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4),
    [data, context],
  );
  const relevantEvents = data.events
    .map((event) => ({ event, entity: data.entities.find((e) => e.id === event.entity_id) }))
    .filter(
      (x) =>
        x.entity &&
        relevant(x.entity, context, data).score >= 60 &&
        Date.now() - Date.parse(x.event.published_at) < 90 * 86400000,
    )
    .sort(
      (a, b) =>
        relevant(b.entity!, context, data).score - relevant(a.entity!, context, data).score ||
        Date.parse(b.event.published_at) - Date.parse(a.event.published_at),
    )
    .slice(0, 2);
  const daily = dailyFive(data, context);
  const results = searchEntities(data, initialQuery);
  const intent = detectIntent(initialQuery);
  const decision = buildDecision(data, submittedBuild, context);
  async function post(path: string, body: unknown) {
    const r = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message ?? d.status);
    return d;
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'ERROR');
    } finally {
      setBusy(false);
    }
  }
  async function saveContext(next: UserContext) {
    if (!user) {
      setNotice('请先在设置中创建账户，学习进度和技术档案将保存到你的独立账户。');
      return;
    }
    await post('context', next);
    setContext(next);
    router.refresh();
  }
  function toolRows(list: Entity[]) {
    return (
      <div className="tool-list">
        {list.map((e) => {
          const ev = toolEvidence(data, e);
          return (
            <Link className="tool-row" key={e.id} href={`/tool/${e.slug}`}>
              <span className={`tool-logo logo-${e.slug}`}>{e.name.slice(0, 1)}</span>
              <div>
                <h3>{e.name}</h3>
                <p>{String(e.details.category ?? 'Tool')}</p>
              </div>
              <div className="tool-row-meta">
                <span>{display(fact(data, e.id, 'license')?.value)}</span>
                <small>Verified {fmt(ev.lastVerified)}</small>
              </div>
              <ChevronRight size={17} />
            </Link>
          );
        })}
      </div>
    );
  }
  function eventList(events: Snapshot['events'], limit = 8) {
    return events.length ? (
      <div className="event-list">
        {events.slice(0, limit).map((e) => {
          const ent = data.entities.find((x) => x.id === e.entity_id);
          return (
            <div className="event-row" key={e.id}>
              <div className="timeline-point" />
              <div>
                <div className="row-meta">
                  <span>{ent?.name}</span>
                  <Badge>{e.event_type}</Badge>
                  <time>{fmt(e.published_at)}</time>
                </div>
                <Out href={e.url}>{e.title}</Out>
                <small>
                  来源 {data.sources.find((s) => s.id === e.source_id)?.tier ?? 'UNKNOWN'} ·
                  首次发现 {fmt(e.discovered_at)}
                </small>
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <Empty>UNAVAILABLE · 这个时间窗口内没有已收录事件。不能据此判断外部世界没有变化。</Empty>
    );
  }
  function renderDashboard() {
    return (
      <>
        <div className="page-heading">
          <div>
            <div className="eyebrow">YOUR INTELLIGENCE WORKSPACE</div>
            <h1>动手之前，先看清前沿。</h1>
            <p>理解技术，追溯证据，找到值得采用的已有方案。</p>
          </div>
          <div className="date-label">
            <span className="live-dot" />
            AI AGENT ECOSYSTEM
            <small>{new Date().toISOString().slice(0, 10)} · UTC · Internal v0.1</small>
          </div>
        </div>
        <SearchBox large />
        <div className="suggestions">
          <span>开始探索</span>
          {['长期记忆', 'MCP', '我想给 OpenClaw 增加长期记忆'].map((q) => (
            <Link key={q} href={`/search?q=${encodeURIComponent(q)}`}>
              {q}
              <ArrowUpRight size={12} />
            </Link>
          ))}
        </div>
        <div className="stat-strip">
          <Meta
            label="研究概念"
            value={
              <>
                {concepts.length}
                <small> AI Agent 生态</small>
              </>
            }
          />
          <Meta
            label="代表项目"
            value={
              <>
                {tools.length}
                <small> 持续观察</small>
              </>
            }
          />
          <Meta
            label="已抓取来源"
            value={
              <>
                {verified}
                <small> / {data.sources.length}</small>
              </>
            }
          />
          <Meta
            label="证据事实"
            value={
              <>
                {data.facts.length}
                <small> 可追溯</small>
              </>
            }
          />
        </div>
        <div className="section-head">
          <div>
            <h2>
              Daily 5 <Badge>每日学习</Badge>
            </h2>
            <p>五个节点，逐步建立你的 AI 世界地图。</p>
          </div>
          <span className="muted">
            <Clock size={14} />
            15–20 分钟
          </span>
        </div>
        <div className="daily-grid">
          {daily.map(({ entity: e, relevance: r }, i) => (
            <article className={`daily-card ${i === 0 ? 'featured' : ''}`} key={e.id}>
              <div className="daily-top">
                <span>0{i + 1}</span>
                <span>{i === 0 ? 'FOCUS' : r.level === 'HIGH' ? 'FOR YOU' : 'FOUNDATION'}</span>
              </div>
              <Link href={`/concept/${e.slug}`}>
                <h3>{e.name}</h3>
                <p>{e.summary}</p>
              </Link>
              <div className="daily-bottom">
                <span>{context.learned.includes(e.id) ? '已学习' : '约 3 分钟'}</span>
                <Link href={`/concept/${e.slug}`} aria-label={`学习 ${e.name}`}>
                  <ArrowUpRight size={19} />
                </Link>
              </div>
            </article>
          ))}
        </div>
        <div className="dashboard-columns">
          <section className="panel">
            <div className="section-head compact">
              <h2>
                <Radio size={18} />
                Frontier Radar
              </h2>
              <Link href="/radar">
                查看全部
                <ArrowRight size={14} />
              </Link>
            </div>
            {eventList(
              data.events.filter((e) => Date.now() - Date.parse(e.published_at) < 90 * 86400000),
              4,
            )}
            <div className="panel-foot">仅展示已收录变化。趋势信号不足时保持 UNCERTAIN。</div>
          </section>
          <section className="panel">
            <div className="section-head compact">
              <h2>
                For You <Badge tone="green">PERSONAL</Badge>
              </h2>
              <Link href="/settings">
                <Settings2 size={16} />
              </Link>
            </div>
            {personalized.length ? (
              <div className="for-you">
                {personalized.slice(0, 2).map((e) => (
                  <Link
                    href={`/${e.entity.kind === 'Tool' ? 'tool' : 'concept'}/${e.entity.slug}`}
                    key={e.entity.id}
                  >
                    <div>
                      <Status value={e.level} />
                      <h3>{e.entity.name}</h3>
                      <p>{e.reason}</p>
                    </div>
                    <ArrowUpRight size={18} />
                  </Link>
                ))}
                {relevantEvents.map(({ event, entity: e }) => (
                  <a key={event.id} href={event.url} target="_blank" rel="noopener noreferrer">
                    <div>
                      <Badge tone="green">相关变化 · {fmt(event.published_at)}</Badge>
                      <h3>
                        {e?.name} · {event.title}
                      </h3>
                      <p>该项目与你关注的技术存在关联。相关度为 ANALYSIS，事件可查原始来源。</p>
                    </div>
                    <ExternalLink size={16} />
                  </a>
                ))}
              </div>
            ) : (
              <Empty>
                <h3>让前沿与你有关</h3>
                <p>添加你使用的工具、感兴趣的技术和正在构建的项目。</p>
                <Link href="/settings" className="text-link">
                  设置 Technology Profile <ArrowRight size={14} />
                </Link>
              </Empty>
            )}
          </section>
        </div>
        <section className="panel">
          <div className="section-head compact">
            <h2>Technology Landscape</h2>
            <Link href="/compare">
              比较方案
              <ArrowRight size={14} />
            </Link>
          </div>
          {toolRows(tools.slice(0, 4))}
        </section>
      </>
    );
  }
  function renderSearch() {
    return (
      <>
        <PageHeading kicker="RESEARCH" title="从一个问题，走向技术地图。" />
        <SearchBox initial={initialQuery} />
        <div className="section-head">
          <h2>“{initialQuery}”</h2>
          <Badge>{intent} QUERY</Badge>
        </div>
        {intent === 'BUILD' && (
          <div className="decision-banner">
            <Hammer />
            <div>
              <h3>这是一项构建需求</h3>
              <p>先查看已有方案、证据缺口与集成条件。</p>
            </div>
            <Link className="button primary" href={`/build?q=${encodeURIComponent(initialQuery)}`}>
              进入 Build or Buy
              <ArrowRight size={16} />
            </Link>
          </div>
        )}
        {intent === 'COMPARE' && (
          <Link className="button primary" href="/compare">
            打开结构化比较
          </Link>
        )}
        <div className="results">
          {results.map(({ entity: e }) => (
            <Link
              href={`/${e.kind === 'Tool' ? 'tool' : 'concept'}/${e.slug}`}
              key={e.id}
              className="result-card"
            >
              <Badge>{e.kind.toUpperCase()}</Badge>
              <h2>{e.name}</h2>
              <p>{e.summary}</p>
              <div>
                <span>{data.sources.filter((s) => s.entity_id === e.id).length} 个来源入口</span>
                <ArrowRight size={18} />
              </div>
            </Link>
          ))}
        </div>
        {!results.length && (
          <Empty>
            <h3>UNAVAILABLE · 还没有足够证据</h3>
            <p>目前覆盖 17 个 AI Agent 主题与 7 个代表项目。尝试“长期记忆”、MCP 或 GraphRAG。</p>
          </Empty>
        )}
        <div className="note">
          <ShieldCheck size={17} />
          检索范围：已收录的研究目录。卡片由结构化证据与编辑分析组装；未启用开放式 LLM 研究。
        </div>
      </>
    );
  }
  function renderConcept() {
    if (!entity) return null;
    const related = tools.filter((t) =>
      data.relationships.some((r) => r.from_id === t.id && r.to_id === entity.id),
    );
    const sources = data.sources.filter(
      (s) => s.entity_id === entity.id || related.some((t) => t.id === s.entity_id),
    );
    const fs = data.facts.filter((f) => related.some((t) => t.id === f.entity_id));
    const last = fs
      .map((f) => f.last_verified_at)
      .sort()
      .at(-1);
    const relevance = relevant(entity, context, data);
    const d = buildDecision(data, entity.name, context);
    return (
      <>
        <div className="breadcrumb">
          <Link href="/">工作台</Link>
          <ChevronRight size={13} />
          Frontier Card
        </div>
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              FRONTIER CARD <Badge>CONCEPT</Badge>
            </div>
            <h1>{entity.name}</h1>
            <p>{entity.aliases[0]}</p>
          </div>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              action(() =>
                saveContext({
                  ...context,
                  learned: Array.from(new Set([...context.learned, entity.id])),
                }),
              )
            }
          >
            {context.learned.includes(entity.id) ? <Check size={16} /> : <BookOpen size={16} />}{' '}
            {context.learned.includes(entity.id) ? '已学习' : '标记已学习'}
          </button>
        </div>
        <div className="card-summary">
          <Badge tone="green">一句话理解 · ANALYSIS</Badge>
          <p>{entity.summary}</p>
        </div>
        <div className="stat-strip">
          <Meta label="Last verified · 工具证据" value={fmt(last)} />
          <Meta
            label="Freshness · 工具证据"
            value={freshness(last ?? null) === null ? 'UNAVAILABLE' : `${freshness(last!)} / 100`}
          />
          <Meta label="Confidence · 概念解释" value={<Status value="LOW" />} />
          <Meta label="Personal relevance" value={<Status value={relevance.level} />} />
        </div>
        <div className="detail-columns">
          <div>
            <section className="panel prose">
              <h2>
                为什么存在 <Badge>ANALYSIS</Badge>
              </h2>
              <p>{String(entity.details.why)}</p>
              <h2>工作原理</h2>
              <p>{String(entity.details.how)}</p>
              <div className="flow">
                <span>获取信息</span>
                <ArrowRight size={16} />
                <span>组织与验证</span>
                <ArrowRight size={16} />
                <span>按需使用</span>
              </div>
              <h2>主要技术路线</h2>
              <div className="route-chips">
                {(entity.details.routes as string[]).map((r, i) => (
                  <span key={r}>
                    <b>0{i + 1}</b>
                    {r}
                  </span>
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="section-head compact">
                <h2>Technology Landscape</h2>
                <Link href="/compare">
                  比较
                  <ArrowRight size={14} />
                </Link>
              </div>
              {related.length ? (
                toolRows(related)
              ) : (
                <Empty>UNAVAILABLE · 尚未收录经验证的代表工具。</Empty>
              )}
              <div className="panel-foot">分类关系为编辑分析；工具的当前状态以来源事实为准。</div>
            </section>
            <section className="panel prose">
              <h2>
                Current State <Badge>ANALYSIS</Badge>
              </h2>
              <p>
                {related.length
                  ? `目录收录了 ${related.length} 个相关项目，可作为调研起点。当前证据不足以判断整个领域的成熟度或最佳方案。`
                  : '尚无足够工具证据，不能判断该领域当前成熟度。'}
              </p>
              <h2>技术关系</h2>
              <div className="graph-rows">
                {related.map((t) => (
                  <Link href={`/tool/${t.slug}`} key={t.id}>
                    <Network size={16} />
                    {t.name}
                    <span>→ CATEGORY →</span>
                    {entity.name}
                    <Badge>ANALYSIS</Badge>
                  </Link>
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="section-head compact">
                <h2>Recent Changes</h2>
                <WindowTabs days={days} setDays={setDays} />
              </div>
              {eventList(
                currentEvents.filter(
                  (e) => e.entity_id === entity.id || related.some((t) => t.id === e.entity_id),
                ),
              )}
            </section>
          </div>
          <aside>
            <section className="panel decision-panel">
              <div className="eyebrow">BUILD OR BUY · ANALYSIS</div>
              <h2>{d.decision}</h2>
              <p>{d.reason}</p>
              <div className="necessity">
                <span>Build Necessity Score</span>
                <strong>
                  {d.buildNecessityScore === null
                    ? 'UNAVAILABLE'
                    : `${d.buildNecessityScore} / 100`}
                </strong>
              </div>
              <Link href={`/build?q=${encodeURIComponent(entity.name)}`} className="button primary">
                评估我的需求
                <ArrowRight size={15} />
              </Link>
            </section>
            <section className="panel prose">
              <h2>
                Trend <Status value="UNCERTAIN" />
              </h2>
              <p>UNAVAILABLE · 缺少跨时间、多维度信号。不使用单次热度推断趋势。</p>
              <h2>与你的关系</h2>
              <p>{relevance.reason}</p>
            </section>
            <section className="panel prose">
              <h2>历史视角</h2>
              <form action={`/concept/${slug}`}>
                <label htmlFor="history-date">查看当时已知的证据</label>
                <input
                  id="history-date"
                  name="at"
                  type="date"
                  defaultValue={asOf}
                  max={new Date().toISOString().slice(0, 10)}
                />
                <button className="button">查看快照</button>
              </form>
              {asOf && (
                <>
                  <p>{asOf} · 不回填首次发现之前的事实。</p>
                  <Link href={`/concept/${slug}`}>返回现在</Link>
                </>
              )}
            </section>
          </aside>
        </div>
        <section className="panel">
          <div className="section-head compact">
            <h2>
              Sources <Badge>{sources.length}</Badge>
            </h2>
            <Link href="/sources">
              证据工作台
              <ArrowRight size={14} />
            </Link>
          </div>
          {sources.slice(0, 10).map((s) => (
            <SourceLink key={s.id} s={s} />
          ))}
        </section>
      </>
    );
  }
  function renderTool() {
    if (!entity) return null;
    const evidence = toolEvidence(data, entity);
    const license = fact(data, entity.id, 'license');
    const risky = !['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC'].includes(
      display(license?.value),
    );
    return (
      <>
        <div className="breadcrumb">
          <Link href="/">工作台</Link>
          <ChevronRight size={13} />
          Tool intelligence
        </div>
        <div className="page-heading">
          <div>
            <div className="eyebrow">{String(entity.details.category)}</div>
            <h1>{entity.name}</h1>
            <p>{entity.summary}</p>
          </div>
          <Link href="/compare" className="button">
            加入比较视图
            <GitCompareArrows size={16} />
          </Link>
        </div>
        <div className="stat-strip">
          <Meta label="Current evidence" value={<Status value={evidence.status} />} />
          <Meta label="Last verified" value={fmt(evidence.lastVerified)} />
          <Meta label="Confidence · 已抽取事实" value={confidenceLabel(evidence.confidence)} />
          <Meta
            label="Freshness"
            value={evidence.freshness === null ? 'UNAVAILABLE' : `${evidence.freshness} / 100`}
          />
        </div>
        <div className="detail-columns">
          <section className="panel prose">
            <h2>
              Evidence ledger <Badge tone="green">FACT</Badge>
            </h2>
            <p>每项事实关联具体来源与有效期；缺失字段保留未知。</p>
            {evidence.facts.length ? (
              <div className="fact-list">
                {evidence.facts.map((f) => (
                  <div key={f.id}>
                    <div>
                      <strong>{f.predicate.replaceAll('_', ' ')}</strong>
                      <p>{display(f.value)}</p>
                      <small>
                        有效起点 {fmt(f.valid_from)} · 首次发现 {fmt(f.discovered_at)} ·{' '}
                        {confidenceLabel(f.confidence)}
                      </small>
                    </div>
                    <Link href={`/sources?q=${encodeURIComponent(f.source_id)}`}>
                      证据
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>UNAVAILABLE · 暂无已验证事实。</Empty>
            )}
            <h2>
              适用与限制 <Badge>ANALYSIS</Badge>
            </h2>
            <p>
              适合作为 {String(entity.details.category)}{' '}
              方向的候选。部署复杂度、性能、成本与实际质量需要结合你的任务验证。
            </p>
            <p>如果许可证或数据处理条款尚未确认，不应把代码直接引入商业产品。</p>
          </section>
          <aside>
            <section className="panel prose">
              <h2>项目入口</h2>
              <Out href={String(entity.details.url)}>Official website</Out>
              <Out href={`https://github.com/${entity.details.repo}`}>GitHub repository</Out>
              <h2>License</h2>
              <p>{display(license?.value)}</p>
              {risky && <Status value="LICENSE_REVIEW_REQUIRED" />}
              <h2>Maturity</h2>
              <Status value="UNAVAILABLE" />
              <p>仓库未归档不等于生产成熟。</p>
              <h2>Pricing</h2>
              <Status value="UNAVAILABLE" />
            </section>
            <section className="panel prose">
              <h2>Trend</h2>
              <Status value={trend(data, entity.id).direction} />
              <p>{trend(data, entity.id).reason}</p>
            </section>
          </aside>
        </div>
        <section className="panel">
          <div className="section-head compact">
            <h2>来源与验证</h2>
          </div>
          {evidence.sources.map((s) => (
            <SourceLink s={s} key={s.id} />
          ))}
        </section>
        <section className="panel">
          <div className="section-head compact">
            <h2>Recent Changes</h2>
          </div>
          {eventList(data.events.filter((e) => e.entity_id === entity.id))}
        </section>
      </>
    );
  }
  const compareDimensions: [string, string, boolean][] = [
    ['Category', 'category', false],
    ['Core purpose', 'summary', false],
    ['Architecture', 'architecture', true],
    ['Open source', 'open_source', true],
    ['License', 'license', true],
    ['Deployment', 'readme_mentions_self_host', true],
    ['Memory type', 'readme_mentions_memory', true],
    ['Temporal support', 'readme_mentions_temporal', true],
    ['Knowledge graph', 'readme_mentions_graph', true],
    ['MCP', 'readme_mentions_mcp', true],
    ['Integrations', 'documented_integration_openclaw', true],
    ['Pricing', 'pricing', true],
    ['Activity', 'last_push', true],
    ['Maturity', 'maturity', true],
    ['Strengths', 'strengths', false],
    ['Weaknesses', 'weaknesses', false],
    ['Best for', 'best_for', false],
    ['Avoid when', 'avoid_when', false],
    ['Last verified', 'last_verified', true],
  ];
  function compareValue(e: Entity, key: string, isFact: boolean) {
    if (key === 'last_verified') return fmt(toolEvidence(data, e).lastVerified);
    if (key === 'category') return String(e.details.category);
    if (key === 'summary') return e.summary;
    if (key === 'best_for') return `${String(e.details.category)} 方向的验证候选`;
    if (key === 'avoid_when') return '许可证、隐私条款或任务质量尚未验证时';
    if (key === 'strengths' || key === 'weaknesses') return '尚未进行任务级测试';
    if (isFact) {
      const f = fact(data, e.id, key);
      if (!f) return <span className="unknown">UNAVAILABLE</span>;
      return (
        <>
          <span>{display(f.value)}</span>
          <Link className="evidence-ref" href={`/sources?q=${encodeURIComponent(f.source_id)}`}>
            [证据]
          </Link>
          {key === 'license' &&
            !['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'BSD-2-Clause'].includes(
              display(f.value),
            ) && <Badge tone="amber">LICENSE_REVIEW_REQUIRED</Badge>}
        </>
      );
    }
    return 'UNAVAILABLE';
  }
  function renderCompare() {
    const chosen = tools.filter((t) => selected.includes(t.id));
    return (
      <>
        <PageHeading
          kicker="DECISION SUPPORT"
          title="把方案放在同一张桌上。"
          subtitle="事实有来源，分析有边界。未知维度不会被自动补全。"
        />
        <div className="compare-controls">
          {tools.map((t) => (
            <label key={t.id} className={selected.includes(t.id) ? 'selected' : ''}>
              <input
                type="checkbox"
                checked={selected.includes(t.id)}
                onChange={(e) => {
                  if (e.target.checked && selected.length >= 4) {
                    setNotice('最多同时比较 4 个项目。');
                    return;
                  }
                  setSelected(
                    e.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id),
                  );
                }}
              />
              {t.name}
            </label>
          ))}
        </div>
        {chosen.length ? (
          <div className="comparison-wrap">
            <table className="comparison">
              <thead>
                <tr>
                  <th>
                    比较维度<small>FACT / ANALYSIS</small>
                  </th>
                  {chosen.map((e) => (
                    <th key={e.id}>
                      <Link href={`/tool/${e.slug}`}>
                        {e.name}
                        <ArrowUpRight size={16} />
                      </Link>
                      <span>{String(e.details.category)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compareDimensions.map(([label, key, isFact]) => (
                  <tr key={key}>
                    <th>
                      {label}
                      <Badge tone={isFact ? 'green' : 'neutral'}>
                        {isFact ? 'FACT' : 'ANALYSIS'}
                      </Badge>
                    </th>
                    {chosen.map((e) => (
                      <td key={e.id}>{compareValue(e, key, isFact)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>选择至少一个工具开始比较。</Empty>
        )}
        <div className="note">
          <ShieldCheck size={17} />
          README
          短语只证明项目文档提及该能力，不是独立功能测试。定价、成熟度和具体集成未知时需要补充研究。
        </div>
      </>
    );
  }
  function renderBuild() {
    return (
      <>
        <PageHeading
          kicker="KNOW BEFORE YOU BUILD"
          title="这一次，真的需要从零开发吗？"
          subtitle="先核查已有方案，再决定 Build / Buy / Integrate。"
        />
        <form
          className="build-form"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmittedBuild(buildQ);
          }}
        >
          <label htmlFor="build-query">你准备构建什么？</label>
          <textarea
            id="build-query"
            value={buildQ}
            onChange={(e) => setBuildQ(e.target.value)}
            maxLength={500}
            required
          />
          <button className="button primary">
            评估已有方案
            <ArrowRight size={17} />
          </button>
        </form>
        <div className="build-result">
          <div className="decision-result">
            <div>
              <Badge>ANALYSIS · 规则评估</Badge>
              <h2>{decision.decision}</h2>
              <p>{decision.reason}</p>
            </div>
            <div className="score">
              <span>Build Necessity Score</span>
              <strong>
                {decision.buildNecessityScore === null ? '—' : decision.buildNecessityScore}
              </strong>
              <span>
                {decision.buildNecessityScore === null
                  ? 'UNAVAILABLE · 证据不足'
                  : '/ 100 · 暂定分析'}
              </span>
            </div>
          </div>
          <div className="note">{decision.method}</div>
        </div>
        <div className="section-head">
          <h2>
            Existing Solutions <Badge>{decision.candidates.length}</Badge>
          </h2>
          <Status value={decision.confidence} />
        </div>
        <div className="solution-grid">
          {decision.candidates.map((c) => (
            <section className="panel solution" key={c.entity.id}>
              <div className="section-head compact">
                <Link href={`/tool/${c.entity.slug}`}>
                  <h2>
                    {c.entity.name}
                    <ArrowUpRight size={16} />
                  </h2>
                </Link>
                <Badge>候选</Badge>
              </div>
              <p>{c.entity.summary}</p>
              {c.plugin && (
                <p className="plugin-evidence">
                  <Out href={c.plugin.url}>{c.plugin.package}</Out>
                  <small>官方文档已声明 · 运行兼容性尚未实测</small>
                </p>
              )}
              <dl>
                <dt>能力关键词覆盖 · ANALYSIS</dt>
                <dd>
                  {c.coverage === null
                    ? 'UNAVAILABLE'
                    : `${c.coverage}% (${c.matched.length}/${c.requirements.length})`}
                </dd>
                <dt>OpenClaw / 环境兼容性</dt>
                <dd>
                  <Status value={c.compatibility} />
                </dd>
                <dt>维护状态 · FACT</dt>
                <dd>{c.maintenance}</dd>
                <dt>
                  {/openclaw/i.test(submittedBuild) ? 'Plugin License' : 'Repository License'} ·
                  FACT
                </dt>
                <dd>{display(c.license)}</dd>
                <dt>成熟度 / 成本 / 部署难度</dt>
                <dd>UNAVAILABLE</dd>
                <dt>依赖 / 隐私 / Vendor Lock-in</dt>
                <dd>UNAVAILABLE</dd>
                <dt>Integration Complexity</dt>
                <dd>UNAVAILABLE</dd>
              </dl>
              {c.licenseReview && <Badge tone="amber">LICENSE_REVIEW_REQUIRED</Badge>}
              <Link href={`/tool/${c.entity.slug}`} className="text-link">
                核查 {c.evidence.facts.length} 条事实
                <ArrowRight size={15} />
              </Link>
            </section>
          ))}
        </div>
        {!decision.candidates.length && (
          <Empty>UNAVAILABLE · 在当前目录中没有找到匹配的候选方案。</Empty>
        )}
      </>
    );
  }
  function renderRadar() {
    const filtered = currentEvents.filter(
      (e) => radarFilter === 'ALL' || e.event_type === radarFilter,
    );
    return (
      <>
        <div className="page-heading">
          <div>
            <div className="eyebrow">OBSERVE → VERIFY → UNDERSTAND</div>
            <h1>Radar</h1>
            <p>时间线上发生了什么，与当前证据能说明什么。</p>
          </div>
          <button
            disabled={busy}
            className="button"
            onClick={() =>
              action(async () => {
                const r = await post('radar/refresh', {});
                setNotice(`刷新结果：${r.status}。每个来源的状态已保存。`);
                router.refresh();
              })
            }
          >
            <RefreshCw size={16} className={busy ? 'spin' : ''} />
            {busy ? '正在抓取来源…' : '刷新真实来源'}
          </button>
        </div>
        <div className="filter-bar">
          <div className="tabs">
            {[
              ['ALL', '全部变化'],
              ['RELEASE', '正式发布'],
              ['OBSERVED_CHANGE', '事实变化'],
              ['DISCUSSION', '社区讨论'],
            ].map(([v, l]) => (
              <button
                className={radarFilter === v ? 'active' : ''}
                onClick={() => setRadarFilter(v)}
                key={v}
              >
                {l}
              </button>
            ))}
          </div>
          <WindowTabs days={days} setDays={setDays} />
        </div>
        <div className="dashboard-columns">
          <section className="panel">
            <div className="section-head compact">
              <h2>Recent Changes</h2>
              <Badge>{filtered.length} COLLECTED</Badge>
            </div>
            {eventList(filtered, 30)}
          </section>
          <section className="panel prose">
            <h2>Signal Watch</h2>
            <p>真实观测与变化速度分开显示。没有历史数据，就没有趋势结论。</p>
            {tools.map((t) => {
              const sig = data.signals.find(
                (s) => s.entity_id === t.id && s.metric === 'github_stars',
              );
              const tr = trend(data, t.id);
              return (
                <div className="signal-row" key={t.id}>
                  <Link href={`/tool/${t.slug}`}>{t.name}</Link>
                  <div>
                    <strong>
                      {sig?.value === undefined ? 'UNAVAILABLE' : sig.value?.toLocaleString()}
                    </strong>
                    <small>Stars · {fmt(sig?.observed_at)}</small>
                    <span>
                      {tr.velocity === null
                        ? 'Velocity UNAVAILABLE'
                        : `${tr.velocity.toFixed(1)} stars/day`}
                    </span>
                    <Status value={tr.direction} />
                  </div>
                </div>
              );
            })}
            <h3>其他信号</h3>
            <p>贡献者增长、搜索增长、商业采用、文档变化率：UNAVAILABLE。接入并积累观测后才计算。</p>
          </section>
        </div>
      </>
    );
  }
  function renderSources() {
    const list = data.sources.filter(
      (s) =>
        (sourceFilter === 'ALL' || s.tier === sourceFilter) &&
        (initialQuery
          ? `${s.id} ${s.title}`.toLowerCase().includes(initialQuery.toLowerCase())
          : true),
    );
    return (
      <>
        <PageHeading
          kicker="EVIDENCE FIRST"
          title="每个判断，都应该有来处。"
          subtitle="保留来源元数据、结构化事实与抓取记录，不永久复制整篇外部内容。"
        />
        <div className="filter-bar">
          <div className="tabs">
            {['ALL', 'S', 'A', 'B', 'C'].map((t) => (
              <button
                className={sourceFilter === t ? 'active' : ''}
                key={t}
                onClick={() => setSourceFilter(t)}
              >
                {t === 'ALL' ? '全部来源' : `Tier ${t}`}
              </button>
            ))}
          </div>
          <span>{list.length} SOURCES</span>
        </div>
        <div className="source-policy">
          <span>
            <b>S</b> 官方文档 / GitHub / 论文
          </span>
          <span>
            <b>A</b> 官方博客
          </span>
          <span>
            <b>B</b> 开发者社区
          </span>
          <span>
            <b>C</b> 仅用于发现弱信号
          </span>
        </div>
        <div className="sources-list">
          {list.map((s) => (
            <details className="panel" key={s.id} open={!!initialQuery}>
              <summary>
                <span className="source-title">
                  <Badge tone={s.tier === 'S' ? 'green' : 'neutral'}>TIER {s.tier}</Badge>
                  <strong>{s.title}</strong>
                  <small>{new URL(s.url).hostname}</small>
                </span>
                <Status value={effectiveStatus(s)} />
              </summary>
              <div className="source-detail">
                <Out href={s.url}>原始来源</Out>
                <div className="source-dates">
                  <Meta label="retrieved_at" value={s.retrieved_at ?? 'UNAVAILABLE'} />
                  <Meta label="published_at" value={s.published_at ?? 'UNAVAILABLE'} />
                  <Meta
                    label="Freshness"
                    value={
                      freshness(s.retrieved_at) === null
                        ? 'UNAVAILABLE'
                        : `${freshness(s.retrieved_at)} / 100`
                    }
                  />
                </div>
                {s.error && <p className="error-text">{s.error}</p>}
                <p className="muted">
                  {String(
                    s.metadata.verification_scope ??
                      s.metadata.scope ??
                      s.metadata.extraction ??
                      '来自官方端点的结构化数据。',
                  )}
                </p>
                <div className="fact-list">
                  {data.facts
                    .filter((f) => f.source_id === s.id)
                    .map((f) => (
                      <div key={f.id}>
                        <div>
                          <Badge tone="green">FACT · {confidenceLabel(f.confidence)}</Badge>
                          <strong>{f.predicate}</strong>
                          <p>{display(f.value)}</p>
                          <small>
                            discovered_at {fmt(f.discovered_at)} · valid_from {fmt(f.valid_from)} ·
                            valid_until {fmt(f.valid_until)} · last_verified_at{' '}
                            {fmt(f.last_verified_at)}
                          </small>
                        </div>
                      </div>
                    ))}
                </div>
                {!data.facts.some((f) => f.source_id === s.id) && (
                  <p>没有已抽取事实；来源可达不等于结论已被验证。</p>
                )}
              </div>
            </details>
          ))}
        </div>
        {!list.length && <Empty>UNAVAILABLE · 当前筛选没有来源。</Empty>}
      </>
    );
  }
  function renderSettings() {
    return (
      <>
        <PageHeading
          kicker="PERSONAL RELEVANCE"
          title="让你的技术背景成为过滤器。"
          subtitle="你的工具、兴趣和项目只属于你的账户。"
        />
        <div className="detail-columns">
          <section className="panel prose">
            <h2>Technology Profile</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                action(async () => {
                  await saveContext({
                    uses: uses
                      .split(/[,，\n]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                    interests: interests
                      .split(/[,，\n]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                    building,
                    learned: context.learned,
                  });
                  if (user) setNotice('技术档案已保存。返回工作台查看 For You。');
                });
              }}
            >
              <label htmlFor="uses">Uses · 正在使用</label>
              <input
                id="uses"
                value={uses}
                onChange={(e) => setUses(e.target.value)}
                placeholder="OpenClaw, Obsidian, Windows"
                maxLength={2400}
              />
              <label htmlFor="interests">Interested In · 感兴趣</label>
              <input
                id="interests"
                value={interests}
                onChange={(e) => setInterests(e.target.value)}
                placeholder="长期记忆, MCP, Computer Use"
                maxLength={2400}
              />
              <label htmlFor="building">Building · 正在开发</label>
              <textarea
                id="building"
                value={building}
                onChange={(e) => setBuilding(e.target.value)}
                placeholder="为个人研究助手选择长期记忆方案"
                maxLength={1000}
              />
              <p className="muted">
                多项内容用逗号分隔。v0.1 使用可解释关键词和分类关系计算相关度。
              </p>
              <button disabled={busy || !user} className="button primary">
                保存技术档案
                <Check size={16} />
              </button>
              {!user && <p>请先创建账户或登录，再保存档案。</p>}
            </form>
          </section>
          <aside>
            <section className="panel prose">
              <h2>{user ? '账户' : '本地研究账户'}</h2>
              {user ? (
                <>
                  <p className="account-email">{user.email}</p>
                  <Badge tone="green">已登录 · 独立档案</Badge>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        await post('auth/logout', {});
                        window.location.assign('/settings');
                      })
                    }
                  >
                    退出登录
                  </button>
                  <details>
                    <summary>个人数据管理</summary>
                    <p>
                      清除会删除技术档案、搜索记录和模型缓存；删除账户还会撤销全部登录。操作需要重新输入密码。
                    </p>
                    <label htmlFor="privacy-password">当前密码 · 数据操作验证</label>
                    <input
                      id="privacy-password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      maxLength={128}
                    />
                    <button
                      className="button"
                      disabled={busy || !password}
                      onClick={() =>
                        action(async () => {
                          await post('privacy/clear', { password });
                          window.location.assign('/settings');
                        })
                      }
                    >
                      清除个人研究数据
                    </button>
                    <button
                      className="button"
                      disabled={busy || !password}
                      onClick={() => {
                        if (window.confirm('永久删除此账户及个人数据，并撤销所有登录？'))
                          void action(async () => {
                            await post('auth/delete', { password });
                            window.location.assign('/settings');
                          });
                      }}
                    >
                      删除账户
                    </button>
                  </details>
                </>
              ) : (
                <>
                  <div className="tabs">
                    <button
                      className={authMode === 'register' ? 'active' : ''}
                      onClick={() => setAuthMode('register')}
                    >
                      创建账户
                    </button>
                    <button
                      className={authMode === 'login' ? 'active' : ''}
                      onClick={() => setAuthMode('login')}
                    >
                      登录
                    </button>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      action(async () => {
                        await post(`auth/${authMode}`, { email, password });
                        window.location.assign('/settings');
                      });
                    }}
                  >
                    <label htmlFor="email">邮箱</label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                    <label htmlFor="password">密码 · 至少 12 个字符</label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={12}
                      maxLength={128}
                      autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                    />
                    <button className="button primary" disabled={busy}>
                      {authMode === 'register' ? '创建账户' : '登录'}
                    </button>
                  </form>
                  <p className="muted">Internal MVP 账户；暂不支持邮箱验证和密码找回。</p>
                </>
              )}
            </section>
            <section className="panel prose">
              <h2>模型与成本</h2>
              <Status value={modelConfigured ? 'CONFIGURED' : 'UNAVAILABLE'} />
              <p>
                {modelConfigured
                  ? '已配置 DeepSeek Flash。模型分析按需调用，费用受每日预算限制；基础浏览无需模型。'
                  : '模型服务未启用，仍可浏览已有证据和编辑分析。'}
              </p>
              <p>
                主动请求模型分析时，提交的问题及相关公开证据会发送至模型服务。技术档案不会自动发送。模型输出为
                ANALYSIS。
              </p>
            </section>
          </aside>
        </div>
      </>
    );
  }
  const screens: Record<string, () => React.ReactNode> = {
    dashboard: renderDashboard,
    search: renderSearch,
    concept: renderConcept,
    tool: renderTool,
    compare: renderCompare,
    build: renderBuild,
    radar: renderRadar,
    sources: renderSources,
    settings: renderSettings,
  };
  return (
    <div className="app-shell">
      <aside className={`sidebar ${sideOpen ? 'open' : ''}`}>
        <Link className="brand" href="/">
          <span className="brand-mark">
            <Layers size={24} />
          </span>
          <span>
            AI FRONTIER<small>INTELLIGENCE</small>
          </span>
        </Link>
        <div className="workspace">
          <span className="workspace-icon">AF</span>
          <div>
            Research workspace<small>Internal MVP</small>
          </div>
          <span className="workspace-dot" />
        </div>
        <span className="nav-label">EXPLORE</span>
        <nav>
          {nav.map(([id, label, Icon, url]) => (
            <Link
              key={id}
              href={url}
              className={route === id ? 'active' : ''}
              onClick={() => setSideOpen(false)}
            >
              <Icon size={18} />
              {label}
              {id === 'radar' && <span className="nav-count">{data.events.length}</span>}
            </Link>
          ))}
        </nav>
        <span className="nav-label topics-label">RESEARCH SCOPE</span>
        <div className="scope-tree">
          <span className="scope-root">
            <span className="live-dot" />
            AI Agent Ecosystem
          </span>
          {[
            ['long-term-memory', 'Memory & Context'],
            ['agent-framework', 'Agents & Frameworks'],
            ['mcp', 'Protocols & Tools'],
          ].map(([id, label]) => (
            <Link href={`/concept/${id}`} key={id}>
              <span />
              {label}
            </Link>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="principle">
            <ShieldCheck size={18} />
            <strong>Know Before You Build.</strong>
            <p>Evidence. Time. Relevance.</p>
          </div>
          <Link href="/settings" className={route === 'settings' ? 'active' : ''}>
            <Settings2 size={18} />
            <span>设置与技术档案</span>
            <span className="avatar">{user ? user.email[0].toUpperCase() : 'G'}</span>
          </Link>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="menu-button"
              aria-label="切换导航"
              onClick={() => setSideOpen(!sideOpen)}
            >
              {sideOpen ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {nav.find((n) => n[0] === route)?.[1] ??
                (route === 'settings'
                  ? 'Technology Profile'
                  : route === 'search'
                    ? 'Research'
                    : 'Intelligence')}
            </strong>
          </div>
          <div>
            <span className="evidence-label">
              <span className="live-dot" />
              Evidence first
            </span>
            <Link className="top-account" href="/settings">
              {user ? 'My profile' : 'Guest'}
              <span className="avatar">{user ? user.email[0].toUpperCase() : 'G'}</span>
            </Link>
          </div>
        </header>
        <main className="main-content">
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button onClick={() => setNotice('')} aria-label="关闭提示">
                ×
              </button>
            </div>
          )}
          {asOf && (
            <div className="notice">
              历史快照 {asOf}：只显示当时已收录的事实；概念解释仍为当前编辑分析。
            </div>
          )}
          {screens[route]?.()}
        </main>
        <footer className="footer">
          <span>AI FRONTIER INTELLIGENCE</span>
          <span>事实可追溯 · 分析明确标注 · 未知保持未知</span>
          <span>v0.1 Internal</span>
        </footer>
      </div>
    </div>
  );
}
function PageHeading({
  kicker,
  title,
  subtitle,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{kicker}</div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}
function WindowTabs({ days, setDays }: { days: number; setDays: (d: number) => void }) {
  return (
    <div className="tabs small">
      {[7, 30, 90].map((d) => (
        <button onClick={() => setDays(d)} key={d} className={days === d ? 'active' : ''}>
          {d} days
        </button>
      ))}
    </div>
  );
}
