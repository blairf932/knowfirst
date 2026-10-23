import { assertSafeTree } from './release-safety.mjs';
import { access, cp, readdir, readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
try {
  process.loadEnvFile('.env');
} catch {}
const secrets = [process.env.LLM_API_KEY, process.env.GITHUB_TOKEN].filter(
  (s) => s && s.length > 8,
);
for (const input of ['.next/static', 'public', 'db/migrations'])
  await assertSafeTree(input, secrets);
const lockHash = createHash('sha256')
  .update(await readFile('package-lock.json'))
  .digest('hex');
const buildId = (await readFile('.next/BUILD_ID', 'utf8')).trim();
// Each artifact gets a fresh directory. No deletion of existing user artifacts.
const destination = path.resolve('dist', `release-${Date.now()}`);
await mkdir(destination, { recursive: true });
for (const entry of ['server.js', 'package.json', 'node_modules', '.next'])
  await cp(path.join('.next/standalone', entry), path.join(destination, entry), {
    recursive: true,
    dereference: true,
    filter: (source) =>
      !/(?:^|[\\/])(?:sharp|@img|\.env[^\\/]*|[^\\/]+\.env(?:\.[^\\/]*)?|\.data|\.cache|backups|\.git)(?:[\\/]|$)/i.test(
        source,
      ),
  });
const requiredRuntime = path.join(
  destination,
  'node_modules/next/dist/compiled/next-server/app-route-turbo.runtime.prod.js',
);
// Retain Next's serialized build configuration, but use AFI's draining shutdown path.
const bootstrapPath = path.join(destination, 'server.js');
const bootstrap = await readFile(bootstrapPath, 'utf8');
const marker = "require('next')";
if (!bootstrap.includes(marker)) throw new Error('Unknown standalone bootstrap format');
// Serialized build roots disclose the build machine's account path. Relocate only
// exact build-root values; never rewrite dependency code or arbitrary content.
const buildRootLiteral = JSON.stringify(process.cwd());
await writeFile(
  bootstrapPath,
  bootstrap.slice(0, bootstrap.indexOf(marker)).replaceAll(buildRootLiteral, '__dirname') +
    "await import('./afi-server.mjs');\n",
);
const requiredFilesPath = path.join(destination, '.next/required-server-files.json');
const requiredFiles = JSON.parse(await readFile(requiredFilesPath, 'utf8'));
function relocateBuildRoot(value) {
  if (value === process.cwd()) return '.';
  if (Array.isArray(value)) return value.map(relocateBuildRoot);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, relocateBuildRoot(item)]),
    );
  return value;
}
await writeFile(requiredFilesPath, JSON.stringify(relocateBuildRoot(requiredFiles)));
await cp('scripts/server.mjs', path.join(destination, 'afi-server.mjs'));
await access(requiredRuntime)
  .then(() => stat(requiredRuntime))
  .then((info) => {
    if (!info.isFile() || info.size === 0)
      throw new Error('Standalone release runtime is not a file');
  })
  .catch(() => {
    throw new Error('Standalone release is missing the required App Route runtime');
  });
await cp('.next/static', path.join(destination, '.next/static'), { recursive: true });
await cp('public', path.join(destination, 'public'), { recursive: true });
await cp('db/migrations', path.join(destination, 'db/migrations'), { recursive: true });
await cp('LICENSE', path.join(destination, 'LICENSE'));
await cp('THIRD_PARTY_NOTICES.txt', path.join(destination, 'THIRD_PARTY_NOTICES.txt'));
const noticeDir = path.join(destination, 'public', 'licenses');
await mkdir(noticeDir, { recursive: true });
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location || entry.dev) continue;
  let files;
  try {
    files = await readdir(location);
  } catch {
    continue;
  }
  for (const file of files.filter((f) => /^(licen[sc]e|copying|notice)(\.|$)/i.test(f))) {
    const target = path.join(noticeDir, location.replaceAll('/', '_') + '_' + file);
    try {
      await cp(path.join(location, file), target, { recursive: true });
    } catch {
      throw new Error('License copy failed');
    }
  }
}
const packages = [];
async function scan(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (/^(sharp|@img|\.env.*|[^\\/]+\.env|\.data|\.cache|backups|\.git)$/i.test(e.name))
      throw new Error('Restricted component or secret file in release');
    if (e.isDirectory()) await scan(p);
    else if (e.isSymbolicLink()) throw new Error('Release contains unresolved symlink');
    else {
      const content = await readFile(p);
      if (secrets.some((s) => content.includes(Buffer.from(s))))
        throw new Error('Configured secret found in release content');
      if (e.name === 'package.json') {
        const pkg = JSON.parse(await readFile(p, 'utf8'));
        if (pkg.name && pkg.version)
          packages.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? null });
      }
    }
  }
}
await scan(destination);
await assertSafeTree(destination, secrets);
const artifactPackage = JSON.parse(await readFile(path.join(destination, 'package.json'), 'utf8'));
await writeFile(
  'docs/release-artifact.json',
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      artifactDirectory: path.basename(destination),
      version: artifactPackage.version,
      lockHash,
      buildId,
      secretContentScan: 'PASS',
      forbiddenComponents: [],
      requiredRuntime: {
        path: 'node_modules/next/dist/compiled/next-server/app-route-turbo.runtime.prod.js',
        status: 'PASS',
      },
      packages,
    },
    null,
    2,
  ),
);
// Publish the pointer last so a partially written report cannot become the active artifact.
await writeFile('.cache/release-path.txt', destination);
console.log(
  JSON.stringify({
    artifact: destination,
    packages: packages.length,
    sharpLibvips: 'ABSENT',
    envFiles: 'ABSENT',
  }),
);
