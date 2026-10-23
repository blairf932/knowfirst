import { z } from 'zod';
import type { SourceAdapter } from './types';
import { fetchSource } from './http';
export const hackerNewsAdapter: SourceAdapter = {
  id: 'hackernews',
  async collect(s) {
    const d = z
      .object({
        hits: z.array(
          z.object({ objectID: z.string(), title: z.string().nullable(), created_at: z.string() }),
        ),
      })
      .parse(JSON.parse((await fetchSource(s.url)).body));
    return {
      status: 'AVAILABLE',
      metadata: { count: d.hits.length, scope: 'Community discussion; not product validation' },
      events: d.hits
        .filter((x) => x.title)
        .map((x) => ({
          id: `hn-${x.objectID}`,
          title: x.title!.slice(0, 200),
          published_at: x.created_at,
          url: `https://news.ycombinator.com/item?id=${encodeURIComponent(x.objectID)}`,
          event_type: 'DISCUSSION',
        })),
    };
  },
};
