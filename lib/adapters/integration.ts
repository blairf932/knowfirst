import { z } from 'zod';
import type { SourceAdapter } from './types';
import { fetchSource } from './http';
import { integrationConfigs, packageUrl } from '../integrations';
export const integrationAdapter: SourceAdapter = {
  id: 'integration',
  async collect(source) {
    const config = integrationConfigs.find((x) => x.docs === source.url);
    if (!config) throw new Error('Unapproved integration document');
    const r = await fetchSource(source.url, 'text/html');
    if (!r.body.includes(config.package) || !/OpenClaw/i.test(r.body))
      return {
        status: 'PARTIAL',
        metadata: { scope: 'Official page fetched; expected package declaration was not found.' },
        facts: [],
      };
    return {
      status: 'AVAILABLE',
      metadata: {
        scope:
          'Verified vendor documentation names this OpenClaw plugin. Runtime compatibility has not been tested.',
        etag: r.etag,
      },
      facts: [
        {
          predicate: 'documented_integration_openclaw',
          value: {
            package: config.package,
            target: 'OpenClaw',
            url: source.url,
            verification: 'Official documentation declaration; not runtime-tested',
          },
          confidence: 0.9,
          locator: {
            format: 'vendor-declaration',
            package: config.package,
            phrase: 'OpenClaw',
            scope: 'Official declaration only',
          },
        },
      ],
    };
  },
};
export const npmPackageAdapter: SourceAdapter = {
  id: 'npm-package',
  async collect(source) {
    const config = integrationConfigs.find((x) => packageUrl(x.package) === source.url);
    if (!config) throw new Error('Unapproved package metadata source');
    const d = z
      .object({
        name: z.literal(config.package),
        version: z.string(),
        license: z.union([z.string(), z.object({ type: z.string() })]).optional(),
        deprecated: z.string().optional(),
      })
      .parse(JSON.parse((await fetchSource(source.url)).body));
    return {
      status: 'AVAILABLE',
      metadata: {
        name: d.name,
        version: d.version,
        scope:
          'npm package manifest, publisher-declared license; separate from host repository license. Package code is not installed.',
      },
      facts: [
        {
          predicate: 'plugin_package',
          value: d.name,
          confidence: 0.95,
          locator: { format: 'json-pointer', path: '/name', version: d.version },
        },
        {
          predicate: 'plugin_version',
          value: d.version,
          confidence: 0.95,
          locator: { format: 'json-pointer', path: '/version', version: d.version },
        },
        {
          predicate: 'plugin_license',
          locator: { format: 'json-pointer', path: '/license', version: d.version },
          value: typeof d.license === 'string' ? d.license : (d.license?.type ?? 'UNKNOWN'),
          confidence: 0.9,
        },
        {
          predicate: 'plugin_deprecation',
          locator: {
            format: 'json-pointer',
            path: '/deprecated',
            absenceMeans: 'NOT_MARKED_DEPRECATED',
            version: d.version,
          },
          value: d.deprecated ?? 'NOT_MARKED_DEPRECATED',
          confidence: 0.9,
        },
      ],
    };
  },
};
