import { z } from 'zod';
import { fetchSource } from './http';
import type { SourceAdapter } from './types';
// Deterministic detection is deliberately narrow. A mention is evidence of a README claim,
// never proof of compatibility, production maturity, benchmark validity or feature quality.
export const readmeAdapter: SourceAdapter = {
  id: 'readme',
  async collect(s) {
    const d = z
      .object({
        content: z.string(),
        encoding: z.literal('base64'),
        sha: z.string(),
        html_url: z.url().nullable(),
      })
      .parse(JSON.parse((await fetchSource(s.url)).body));
    const body = Buffer.from(d.content, 'base64').toString('utf8');
    const markers: [string, RegExp][] = [
      ['memory', /\b(long.term memory|memory layer|persistent memory)\b/i],
      ['temporal', /\b(temporal knowledge graph|temporal context graph|bi.temporal)\b/i],
      ['mcp', /\b(MCP server|Model Context Protocol)\b/i],
      ['graph', /\b(knowledge graph|context graph)\b/i],
      ['self_host', /\b(self.host|run locally|local deployment)\w*/i],
    ];
    const claims = markers
      .filter(([, re]) => re.test(body))
      .map(([key, re]) => ({
        predicate: `readme_mentions_${key}`,
        value: { mention: body.match(re)![0], url: d.html_url, commit_blob: d.sha },
        confidence: 0.85,
        locator: {
          format: 'git-blob-phrase',
          sha: d.sha,
          phrase: body.match(re)![0],
          offset: body.search(re),
          scope: 'README mentions a phrase; not a verified capability',
        },
      }));
    return {
      status: 'AVAILABLE',
      metadata: {
        sha: d.sha,
        html_url: d.html_url,
        extraction: 'Constrained README phrase detection. Full text discarded.',
      },
      facts: claims,
    };
  },
};
