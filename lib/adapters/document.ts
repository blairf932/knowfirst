import { fetchSource } from './http';
import type { SourceAdapter } from './types';
export const documentAdapter: SourceAdapter = {
  id: 'document',
  async collect(s) {
    const r = await fetchSource(s.url, 'text/html');
    const title = r.body
      .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/\s+/g, ' ')
      .slice(0, 240);
    return {
      status: title ? 'PARTIAL' : 'UNAVAILABLE',
      metadata: {
        title: title ?? s.title,
        etag: r.etag,
        last_modified: r.lastModified,
        verification_scope:
          'URL reachable and title retrieved; editorial explanation is ANALYSIS, not auto-verified fact.',
      },
    };
  },
};
