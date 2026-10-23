import { z } from 'zod';
import type { SourceAdapter } from './types';
import { fetchSource } from './http';
const repoSchema = z.object({
  full_name: z.string(),
  html_url: z.url(),
  description: z.string().nullable(),
  stargazers_count: z.number().nonnegative(),
  forks_count: z.number().nonnegative(),
  open_issues_count: z.number().nonnegative(),
  archived: z.boolean(),
  pushed_at: z.string().nullable(),
  license: z.object({ spdx_id: z.string() }).nullable(),
  default_branch: z.string(),
});
export const githubAdapter: SourceAdapter = {
  id: 'github',
  async collect(s) {
    const r = await fetchSource(s.url);
    const d = repoSchema.parse(JSON.parse(r.body));
    return {
      status: 'AVAILABLE',
      metadata: { ...d, etag: r.etag },
      facts: [
        ...Object.entries({
          repository: d.html_url,
          description: d.description,
          license: d.license?.spdx_id ?? 'UNKNOWN',
          archived: d.archived,
          last_push: d.pushed_at,
        })
          .filter(([, v]) => v !== null)
          .map(([predicate, value]) => ({
            predicate,
            value,
            confidence: 0.95,
            locator: {
              format: 'json-pointer',
              path: (
                {
                  repository: '/html_url',
                  description: '/description',
                  license: '/license/spdx_id',
                  archived: '/archived',
                  last_push: '/pushed_at',
                } as Record<string, string>
              )[predicate],
              etag: r.etag,
            },
          })),
      ],
      signals: [
        { metric: 'github_stars', value: d.stargazers_count, unit: 'stars' },
        { metric: 'github_forks', value: d.forks_count, unit: 'forks' },
        { metric: 'open_issues', value: d.open_issues_count, unit: 'issues' },
      ],
    };
  },
};
const releaseSchema = z.array(
  z.object({
    id: z.number(),
    name: z.string().nullable(),
    tag_name: z.string(),
    html_url: z.url(),
    published_at: z.string().nullable(),
    draft: z.boolean(),
    prerelease: z.boolean(),
  }),
);
export const releasesAdapter: SourceAdapter = {
  id: 'releases',
  async collect(s) {
    const d = releaseSchema
      .parse(JSON.parse((await fetchSource(s.url)).body))
      .filter((x) => !x.draft && x.published_at);
    return {
      status: 'AVAILABLE',
      metadata: { count: d.length, window: 'most recent 20 releases; not an exhaustive history' },
      events: d.map((x) => ({
        id: `github-release-${x.id}`,
        title: (x.name || x.tag_name).slice(0, 200),
        published_at: x.published_at!,
        url: x.html_url,
        event_type: x.prerelease ? 'PRERELEASE' : 'RELEASE',
      })),
    };
  },
};
