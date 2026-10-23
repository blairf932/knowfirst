import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const permissive = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  '(MIT OR Apache-2.0)',
  '(MIT AND Zlib)',
  'MIT-0',
  'BlueOak-1.0.0',
]);
const rows = [];
const dispositions = [];
let artifact;
try {
  artifact = JSON.parse(await readFile('docs/release-artifact.json', 'utf8'));
} catch {}
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location) continue;
  let metadata;
  try {
    metadata = JSON.parse(await readFile(`${location}/package.json`, 'utf8'));
  } catch {}
  const name = metadata?.name ?? location.split('node_modules/').at(-1);
  const license = metadata?.license ?? entry.license ?? 'UNKNOWN';
  let disposition = permissive.has(license) ? 'KEEP' : 'LEGAL_REVIEW_REQUIRED';
  if (name.startsWith('@img/') && /LGPL/.test(license)) disposition = 'REMOVE';
  if (name === 'caniuse-lite' && license === 'CC-BY-4.0') disposition = 'KEEP_WITH_ATTRIBUTION';
  if (!permissive.has(license))
    dispositions.push({
      name,
      version: entry.version,
      type: name === 'caniuse-lite' ? 'data' : 'software dependency',
      license,
      relationship: 'transitive via Next.js',
      disposition,
      actual_usage:
        name === 'caniuse-lite'
          ? 'Browser compatibility data used by framework/build tooling; unchanged'
          : 'Unused optional sharp image processing native binary; optimizer disabled',
      bundled_or_server:
        name === 'caniuse-lite'
          ? 'Build tooling and traced server dependency; attribution also served publicly'
          : 'Optional server binary; platform-specific development install only',
      commercial_distribution:
        name === 'caniuse-lite'
          ? 'YES if traced; notice always included'
          : 'NO in gated release artifact; still present in development lockfile',
      attribution:
        name === 'caniuse-lite'
          ? 'Preserve creator, source, CC BY 4.0, disclaimer and modification status in THIRD_PARTY_NOTICES.txt and original license'
          : 'If conveyed: preserve component notices and LGPL/GPL/Apache/MIT texts as applicable; excluded instead',
      source_disclosure:
        name === 'caniuse-lite'
          ? 'No application source disclosure required by this license'
          : 'If conveyed, LGPL corresponding library source and combined-work relinking/replacement obligations need review; no blanket application disclosure conclusion',
      redistribution:
        name === 'caniuse-lite'
          ? 'Credit and license link; retain notices, indicate changes; no additional restrictions on licensed material'
          : 'Conditional on LGPL conveyance requirements and other component licenses; artifact exclusion enforced',
      commercial_restriction:
        'No noncommercial-only clause in declared license; conditions still apply',
      alternative:
        name === 'caniuse-lite'
          ? 'No drop-in dataset required; retain with attribution'
          : 'No replacement dependency needed: existing CSS, SVG and browser rendering satisfy all current usage',
      evidence:
        name === 'caniuse-lite'
          ? 'node_modules/caniuse-lite/LICENSE; https://github.com/browserslist/caniuse-lite; https://creativecommons.org/licenses/by/4.0/legalcode.en'
          : 'package-lock.json; https://sharp.pixelplumbing.com/install/; https://www.gnu.org/licenses/lgpl-3.0.html',
    });
  rows.push({
    package: name,
    version: entry.version,
    license,
    scope: pkg.dependencies?.[name]
      ? 'direct runtime'
      : pkg.devDependencies?.[name]
        ? 'direct development'
        : entry.dev
          ? 'transitive development'
          : 'transitive runtime',
    purpose: metadata?.description ?? 'Transitive dependency',
    review: disposition,
  });
}
await mkdir('docs', { recursive: true });
await writeFile(
  'docs/license-inventory.json',
  JSON.stringify({ checked_at: new Date().toISOString(), packages: rows }, null, 2),
);
const failed = rows.filter((x) => x.review === 'LEGAL_REVIEW_REQUIRED');
const notice = `knowfirst �� Third-party notices\n\ncaniuse-lite ${lock.packages['node_modules/caniuse-lite'].version}\nCreator: Ben Briggs and Browserslist/caniuse-lite contributors; underlying Can I Use data contributors (Alexis Deveria and contributors).\nSources: https://github.com/browserslist/caniuse-lite and https://caniuse.com/\nLicense: CC BY 4.0 https://creativecommons.org/licenses/by/4.0/\nUnmodified package data. Provided AS IS, without warranties; no endorsement implied.\nFull original license follows.\n\n${await readFile('node_modules/caniuse-lite/LICENSE', 'utf8')}`;
await writeFile('THIRD_PARTY_NOTICES.txt', notice);
await mkdir('public', { recursive: true });
await writeFile('public/THIRD_PARTY_NOTICES.txt', notice);
await writeFile('docs/license-dispositions.json', JSON.stringify(dispositions, null, 2));
await writeFile(
  'docs/LICENSE_AUDIT.md',
  '# Dependency license audit v0.1.1\n\nEngineering assessment, not a legal guarantee. Exact lockfile versions; all optional platform entries included.\n\n' +
    dispositions
      .map(
        (d) =>
          `## ${d.name} ${d.version}\n\n` +
          Object.entries(d)
            .map(([k, v]) => `- **${k}**: ${v}`)
            .join('\n'),
      )
      .join('\n\n') +
    '\n\n## Full inventory\n\n|Package|Version|License|Disposition|\n|---|---|---|---|\n' +
    rows.map((r) => `|${r.package}|${r.version}|${r.license}|${r.review}|`).join('\n'),
);
const banned =
  artifact?.packages?.filter(
    (p) =>
      p.name === 'sharp' || p.name.startsWith('@img/') || /LGPL|AGPL|GPL-/.test(p.license ?? ''),
  ) ?? [];
const pass =
  !!artifact &&
  artifact.lockHash ===
    createHash('sha256')
      .update(await readFile('package-lock.json'))
      .digest('hex') &&
  artifact.buildId === (await readFile('.next/BUILD_ID', 'utf8')).trim() &&
  artifact.secretContentScan === 'PASS' &&
  !banned.length &&
  !failed.length;
await writeFile(
  'docs/LICENSE_RELEASE_GATE.md',
  `# License release gate\n\nStatus: ${pass ? 'PASS' : 'BLOCKED'}\n\n${dispositions.filter((d) => d.disposition === 'REMOVE').length} optional sharp/libvips flags: REMOVE from commercial artifact, not from development lockfile. caniuse-lite: KEEP_WITH_ATTRIBUTION. ${failed.length} unresolved license declarations.\n\nCommercial deployment must use scripts/package-release.mjs output. Raw node_modules, full development checkout and unfiltered standalone are not approved distribution artifacts. Artifact scanner rejects sharp/@img and .env files. Image optimization disabled. Re-run build, package-release and licenses on every dependency change. Preserve original dependency license files and shipped THIRD_PARTY_NOTICES.txt.\n\nArtifact verified: ${!!artifact}; banned components: ${banned.length}. This gate addresses declared dependency licenses only; it is not a legal guarantee or an overall Commercial Beta approval.\n`,
);
console.log(
  JSON.stringify({
    entries: rows.length,
    removed: dispositions.filter((d) => d.disposition === 'REMOVE').length,
    attribution: dispositions.filter((d) => d.disposition === 'KEEP_WITH_ATTRIBUTION').length,
    unresolved: failed.length,
    artifactGate: pass ? 'PASS' : 'BLOCKED',
  }),
);
if (failed.length || (process.argv.includes('--release') && !pass)) process.exitCode = 1;
