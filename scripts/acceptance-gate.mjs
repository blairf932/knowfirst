// Creates a fresh private PostgreSQL cluster; never reads .env or existing lab config.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile, open } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import pg from 'pg';
import { openSync, closeSync, readFileSync } from 'node:fs';
const root = process.cwd();
const bin = process.env.AFI_PG_BIN;
if (!bin) throw new Error('Set AFI_PG_BIN to existing PostgreSQL binaries');
const lab = path.resolve('.cache', `acceptance-${Date.now()}`);
await mkdir(lab, { recursive: true });
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
const pgPort = await freePort();
const password = randomBytes(32).toString('hex');
const pw = path.join(lab, 'init-password');
await writeFile(pw, password, { mode: 0o600 });
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !/^(?:DATABASE_URL|TEST_.*URL|NODE_OPTIONS|NODE_PATH|GITHUB_TOKEN|LLM_API_KEY|AFI_EXPECT_.*)$/i.test(
        k,
      ),
  ),
);
Object.assign(baseEnv, {
  LLM_API_KEY: '',
  GITHUB_TOKEN: '',
  LLM_PROVIDER: 'disabled',
  SCHEDULER_ENABLED: 'false',
  NEXT_TELEMETRY_DISABLED: '1',
  ERASURE_LEDGER_PATH: path.join(lab, 'erasure.jsonl'),
});
const dbUrl = (name, role = 'frontier_app') => {
  const u = new URL('postgresql://127.0.0.1');
  u.username = role;
  u.password = password;
  u.port = String(pgPort);
  u.pathname = '/' + name;
  return u.href;
};
const pgCmd = (name, args) => {
  const log = path.join(lab, `${name}-command.log`);
  const fd = openSync(log, 'a');
  try {
    return execFileSync(path.join(bin, name + '.exe'), args, {
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      timeout: 60000,
    });
  } catch (error) {
    throw new Error(`${name}: ${readFileSync(log, 'utf8').slice(-1600)}`);
  } finally {
    closeSync(fd);
  }
};
async function run(label, args, env = {}) {
  const file = await open(path.join(lab, label + '.log'), 'w');
  const child = spawn(process.execPath, args, {
    cwd: root,
    windowsHide: true,
    env: { ...baseEnv, ...env },
    stdio: ['ignore', file.fd, file.fd],
  });
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  await file.close();
  console.log(JSON.stringify({ checkpoint: label, exit }));
  return exit;
}
const evidence = {
  generatedAt: new Date().toISOString(),
  status: 'FAIL',
  cluster: { fresh: true, loopbackOnly: true, stopped: false },
  modes: [],
};
let started = false;
let admin;
try {
  pgCmd('initdb', [
    '-D',
    path.join(lab, 'data'),
    '-U',
    'frontier_admin',
    '--pwfile',
    pw,
    '--auth=scram-sha-256',
    '--encoding=UTF8',
    '--locale=C',
  ]);
  await writeFile(pw, '');
  pgCmd('pg_ctl', [
    '-D',
    path.join(lab, 'data'),
    '-l',
    path.join(lab, 'postgres.log'),
    '-o',
    `-h 127.0.0.1 -p ${pgPort}`,
    '-w',
    'start',
  ]);
  started = true;
  admin = new pg.Client({ connectionString: dbUrl('postgres', 'frontier_admin') });
  await admin.connect();
  await admin.query(`CREATE ROLE frontier_app LOGIN PASSWORD '${password}'`);
  const names = [
    'frontier_acceptance_v011',
    'frontier_restore_v011',
    'frontier_tests_v011',
    'frontier_tests_restore_v011',
    'frontier_hardening_v011',
  ];
  for (const name of names) await admin.query(`CREATE DATABASE ${name} OWNER frontier_app`);
  evidence.postgresVersion = (await admin.query('SELECT version()')).rows[0].version;
  evidence.postgresTestsExit = await run(
    'postgres-tests',
    [
      '--import',
      'tsx',
      '--test',
      '--test-concurrency=1',
      'tests/database.test.ts',
      'tests/hardening.test.ts',
    ],
    {
      DATABASE_URL: dbUrl('frontier_tests_v011'),
      TEST_POSTGRES_URL: dbUrl('frontier_tests_v011'),
      TEST_RESTORE_URL: dbUrl('frontier_tests_restore_v011'),
      TEST_HARDENING_URL: dbUrl('frontier_hardening_v011'),
    },
  );
  for (const mode of ['controlled-success', 'controlled-rate-limit', 'live']) {
    for (const name of ['frontier_acceptance_v011', 'frontier_restore_v011']) {
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${name} OWNER frontier_app`);
    }
    const item = { mode };
    evidence.modes.push(item);
    item.collectionExit = await run(
      mode + '-sources',
      ['--import', 'tsx', 'scripts/acceptance-sources.ts', mode],
      { DATABASE_URL: dbUrl('frontier_acceptance_v011') },
    );
    if (item.collectionExit !== 0) continue;
    item.sources = JSON.parse(await readFile(`.cache/sources-${mode}.json`, 'utf8'));
    item.backupExit = await run(
      mode + '-backup',
      ['--import', 'tsx', 'scripts/acceptance-backup.ts'],
      { DATABASE_URL: dbUrl('frontier_acceptance_v011') },
    );
    if (item.backupExit !== 0) continue;
    item.backup = JSON.parse(await readFile('.cache/backup-acceptance.json', 'utf8'));
    const source = item.sources.results.find((x) => x.id === 'github-mem0');
    item.runtimeExit = await run(mode + '-runtime', ['scripts/run-release.mjs'], {
      DATABASE_URL: dbUrl('frontier_restore_v011'),
      RELEASE_GATE_PORT: String(await freePort()),
      AFI_SOURCE_MODE: mode,
      AFI_EXPECT_DECISION: item.sources.decision,
      AFI_EXPECT_SOURCE: source.status,
    });
    item.runtime = JSON.parse(await readFile('docs/RELEASE_RUNTIME_ACCEPTANCE.json', 'utf8'));
    await copyFile('docs/RELEASE_RUNTIME_ACCEPTANCE.json', path.join(lab, mode + '-runtime.json'));
    const logs = await readFile(path.join(lab, mode + '-runtime.log'), 'utf8');
    item.browser = {
      passed: Number(logs.match(/(\d+) passed/)?.[1] || 0),
      failed: Number(logs.match(/(\d+) failed/)?.[1] || 0),
    };
    item.onlineIntegration =
      mode === 'live'
        ? item.sources.decision === 'INTEGRATE' && item.runtimeExit === 0
          ? 'PASS'
          : 'BLOCKED'
        : 'NOT_LIVE';
  }
  evidence.mechanicsStatus =
    evidence.postgresTestsExit === 0 && evidence.modes.every((x) => x.runtimeExit === 0)
      ? 'PASS'
      : 'FAIL';
  evidence.status =
    evidence.mechanicsStatus === 'FAIL'
      ? 'FAIL'
      : evidence.modes.find((x) => x.mode === 'live')?.onlineIntegration === 'PASS'
        ? 'PASS'
        : 'BLOCKED';
} catch (e) {
  evidence.error = e instanceof Error ? e.message : 'Gate error';
  process.exitCode = 1;
} finally {
  if (admin) await admin.end();
  if (started) {
    try {
      pgCmd('pg_ctl', ['-D', path.join(lab, 'data'), '-m', 'fast', '-w', 'stop']);
      evidence.cluster.stopped = true;
    } catch {
      evidence.cluster.stopped = false;
    }
  }
  await writeFile('.cache/acceptance-gate.json', JSON.stringify(evidence, null, 2));
  await writeFile('.cache/acceptance-lab-path.txt', lab);
  console.log(
    JSON.stringify({
      status: evidence.status,
      clusterStopped: evidence.cluster.stopped,
      modes: evidence.modes.map((x) => ({
        mode: x.mode,
        collection: x.collectionExit,
        backup: x.backupExit,
        runtime: x.runtimeExit,
        browser: x.browser,
        onlineIntegration: x.onlineIntegration,
      })),
    }),
  );
  if (evidence.status !== 'PASS' || !evidence.cluster.stopped) process.exitCode = 1;
}
