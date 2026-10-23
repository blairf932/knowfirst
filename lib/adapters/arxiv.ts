import type { SourceAdapter } from './types';
import { fetchSource } from './http';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
const entry = z.object({
  id: z.string(),
  title: z.string(),
  published: z.string(),
  updated: z.string().optional(),
});
export const arxivAdapter: SourceAdapter = {
  id: 'arxiv',
  async collect(s) {
    const r = await fetchSource(s.url, 'application/atom+xml');
    const parsed = new XMLParser({ ignoreAttributes: true, processEntities: false }).parse(r.body);
    const rows = parsed.feed?.entry;
    const papers = z.array(entry).parse(rows ? (Array.isArray(rows) ? rows : [rows]) : []);
    return {
      status: 'AVAILABLE',
      metadata: {
        count: papers.length,
        scope:
          'Paper title, identifier and publication metadata only. Paper claims not independently validated.',
      },
      events: papers.map((p) => {
        const id = p.id.match(/arxiv\.org\/abs\/([\w.\/-]+)/)?.[1];
        if (!id || !Number.isFinite(Date.parse(p.published)))
          throw new Error('Invalid paper metadata');
        return {
          id: `arxiv-${id}`,
          title: p.title.replace(/\s+/g, ' ').slice(0, 200),
          published_at: p.published,
          url: `https://arxiv.org/abs/${id}`,
          event_type: 'PAPER',
        };
      }),
    };
  },
};
