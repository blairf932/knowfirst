import type { SourceAdapter } from './types';
import { githubAdapter, releasesAdapter } from './github';
import { readmeAdapter } from './readme';
import { documentAdapter } from './document';
import { hackerNewsAdapter } from './hackernews';
import { arxivAdapter } from './arxiv';
import { integrationAdapter, npmPackageAdapter } from './integration';
export const adapters = new Map<string, SourceAdapter>(
  [
    githubAdapter,
    releasesAdapter,
    readmeAdapter,
    documentAdapter,
    hackerNewsAdapter,
    arxivAdapter,
    integrationAdapter,
    npmPackageAdapter,
  ].map((a) => [a.id, a]),
);
