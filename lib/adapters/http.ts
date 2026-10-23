import { toolConfigs, concepts } from '../catalog';
import { integrationConfigs, packageUrl } from '../integrations';
const allowed = new Set([
  ...concepts.map((c) => new URL(c.details.url as string).hostname),
  ...integrationConfigs.map((c) => new URL(c.docs).hostname),
  'registry.npmjs.org',
  'api.github.com',
  'github.com',
  'hn.algolia.com',
  'export.arxiv.org',
  'arxiv.org',
  'blog.langchain.com',
  'www.langchain.com',
]);
export class FetchFailure extends Error {
  constructor(
    public status: 'RATE_LIMITED' | 'ERROR',
    message: string,
  ) {
    super(message);
  }
}
export async function fetchSource(
  url: string,
  accept = 'application/json',
  redirects = 0,
): Promise<{ body: string; etag: string | null; lastModified: string | null }> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !allowed.has(u.hostname) || u.username || u.password)
    throw new FetchFailure('ERROR', 'Source URL is outside the approved connector allowlist');
  if (
    u.hostname === 'api.github.com' &&
    !toolConfigs.some(
      (t) =>
        u.pathname === `/repos/${t.repo}` ||
        u.pathname === `/repos/${t.repo}/readme` ||
        u.pathname === `/repos/${t.repo}/releases`,
    )
  )
    throw new FetchFailure('ERROR', 'Unapproved GitHub repository');
  if (
    u.hostname === 'registry.npmjs.org' &&
    !integrationConfigs.some((c) => url === packageUrl(c.package))
  )
    throw new FetchFailure('ERROR', 'Unapproved package metadata source');
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'AI-Frontier-Internal/0.1 (metadata-only research)',
  };
  if (u.hostname === 'api.github.com' && process.env.GITHUB_TOKEN)
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
    redirect: 'manual',
    cache: 'no-store',
  });
  if ([301, 302, 303, 307, 308].includes(r.status)) {
    const target = r.headers.get('location');
    await r.body?.cancel();
    if (!target || redirects >= 3)
      throw new FetchFailure('ERROR', 'Source redirect limit exceeded');
    return fetchSource(new URL(target, u).href, accept, redirects + 1);
  }
  if (r.status === 429 || (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0'))
    throw new FetchFailure('RATE_LIMITED', 'Provider rate limit; retry after quota resets');
  if (!r.ok) throw new FetchFailure('ERROR', `Source HTTP ${r.status}`);
  const reader = r.body?.getReader();
  if (!reader) throw new FetchFailure('ERROR', 'Empty response');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const x = await reader.read();
    if (x.done) break;
    size += x.value.length;
    if (size > 4000000) {
      await reader.cancel();
      throw new FetchFailure('ERROR', 'Source exceeds metadata collection size limit');
    }
    chunks.push(x.value);
  }
  return {
    body: Buffer.concat(chunks).toString('utf8'),
    etag: r.headers.get('etag'),
    lastModified: r.headers.get('last-modified'),
  };
}
