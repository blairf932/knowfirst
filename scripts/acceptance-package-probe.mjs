import { mkdir, writeFile, unlink, rmdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const npmDir = path.resolve('scripts', 'afi-package-sentinel');
const standaloneDir = path.resolve('.next', 'static', 'afi-package-sentinel');
const marker = 'AFI_TEST_ONLY_PACKAGE_SENTINEL_NO_REAL_SECRET';
const report = {
  npmSentinelExcluded: false,
  standaloneSentinelRejected: false,
  artifactPointerUnchanged: false,
};
const before = await readFile('.cache/release-path.txt', 'utf8');
try {
  await mkdir(npmDir, { recursive: true });
  await writeFile(path.join(npmDir, 'nested.env.production'), marker);
  const output = JSON.parse(
    execFileSync('cmd.exe', ['/d', '/c', 'npm pack --json --pack-destination ..'], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    }),
  );
  const pkg = Array.isArray(output) ? output[0] : Object.values(output)[0];
  assert.ok(!pkg.files.some((x) => x.path.includes('afi-package-sentinel')));
  report.npmSentinelExcluded = true;
  await mkdir(standaloneDir, { recursive: true });
  await writeFile(path.join(standaloneDir, 'nested.env.production'), marker);
  let failed = false;
  try {
    execFileSync(process.execPath, ['scripts/package-release.mjs'], { stdio: 'pipe' });
  } catch (error) {
    assert.match(String(error.stderr), /Secret or private path in release input/);
    failed = true;
  }
  assert.ok(failed);
  report.standaloneSentinelRejected = true;
  assert.equal(await readFile('.cache/release-path.txt', 'utf8'), before);
  report.artifactPointerUnchanged = true;
} finally {
  for (const dir of [npmDir, standaloneDir]) {
    await unlink(path.join(dir, 'nested.env.production')).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
    await rmdir(dir).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
}
await writeFile('.cache/package-probe.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
