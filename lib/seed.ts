import { database } from './db';
import { allEntities, concepts, toolConfigs } from './catalog';
import { integrationConfigs, packageUrl } from './integrations';
export async function seed() {
  const db = await database();
  await db.transaction(async (tx) => {
    for (const e of allEntities)
      await tx.query(
        'INSERT INTO entities(id,slug,kind,name,aliases,summary,details) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',
        [
          e.id,
          e.slug,
          e.kind,
          e.name,
          JSON.stringify(e.aliases),
          e.summary,
          JSON.stringify(e.details),
        ],
      );
    for (const t of toolConfigs) {
      const rows = [
        {
          id: `github-${t.slug}`,
          url: `https://api.github.com/repos/${t.repo}`,
          title: `${t.name} · GitHub metadata`,
          adapter: 'github',
        },
        {
          id: `readme-${t.slug}`,
          url: `https://api.github.com/repos/${t.repo}/readme`,
          title: `${t.name} · Official README`,
          adapter: 'readme',
        },
        {
          id: `releases-${t.slug}`,
          url: `https://api.github.com/repos/${t.repo}/releases?per_page=20`,
          title: `${t.name} · Release notes`,
          adapter: 'releases',
        },
      ];
      for (const s of rows)
        await tx.query(
          'INSERT INTO sources(id,url,title,tier,adapter,entity_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
          [s.id, s.url, s.title, 'S', s.adapter, t.slug],
        );
      for (const topic of t.topics)
        await tx.query(
          'INSERT INTO relationships(id,from_id,to_id,predicate,kind,valid_from,discovered_at,confidence) VALUES($1,$2,$3,$4,$5,now(),now(),$6) ON CONFLICT DO NOTHING',
          [`${t.slug}-category-${topic}`, t.slug, topic, 'CATEGORY', 'ANALYSIS', 0.7],
        );
      for (const [to, pred] of [
        [`project-${t.slug}`, 'HAS_PROJECT'],
        [`org-${t.repo.split('/')[0]}`, 'MAINTAINED_BY'],
      ])
        await tx.query(
          'INSERT INTO relationships(id,from_id,to_id,predicate,kind,valid_from,discovered_at,confidence) VALUES($1,$2,$3,$4,$5,now(),now(),$6) ON CONFLICT DO NOTHING',
          [`${t.slug}-${pred}`, t.slug, to, pred, 'ANALYSIS', 0.7],
        );
    }
    for (const c of concepts) {
      const url = c.details.url as string;
      await tx.query(
        'INSERT INTO sources(id,url,title,tier,adapter,entity_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [`docs-${c.slug}`, url, `${c.name} · Reference`, 'S', 'document', c.id],
      );
    }
    await tx.query(
      'INSERT INTO sources(id,url,title,tier,adapter,entity_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [
        'hn-agent',
        'https://hn.algolia.com/api/v1/search_by_date?query=AI%20agent&tags=story&hitsPerPage=10',
        'Hacker News · AI agent discussion',
        'B',
        'hackernews',
        'ai-agent',
      ],
    );
    await tx.query(
      'INSERT INTO sources(id,url,title,tier,adapter,entity_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [
        'arxiv-memory',
        'https://export.arxiv.org/api/query?search_query=ti:agent+AND+ti:memory&start=0&max_results=5&sortBy=submittedDate&sortOrder=descending',
        'arXiv · Agent memory papers',
        'S',
        'arxiv',
        'agent-memory',
      ],
    );
    await tx.query(
      'INSERT INTO sources(id,url,title,tier,adapter,entity_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [
        'blog-langchain',
        'https://blog.langchain.com/',
        'LangChain · Official blog',
        'A',
        'document',
        'agent-framework',
      ],
    );
    for (const config of integrationConfigs) {
      await tx.query(
        'INSERT INTO sources(id,url,title,tier,adapter,entity_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [
          `integration-${config.entityId}`,
          config.docs,
          `${config.entityId} · Official OpenClaw integration`,
          'S',
          'integration',
          config.entityId,
        ],
      );
      await tx.query(
        'INSERT INTO sources(id,url,title,tier,adapter,entity_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [
          `npm-${config.entityId}`,
          packageUrl(config.package),
          `${config.package} · Package manifest`,
          'S',
          'npm-package',
          config.entityId,
        ],
      );
    }
  });
}
