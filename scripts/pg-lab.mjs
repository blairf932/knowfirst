import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
try {
  process.loadEnvFile('.env');
} catch {}
const root = process.cwd();
const bin = path.resolve('.cache/pg17/pgsql/bin');
const data = path.resolve('.data/postgres17');
const configFile = path.resolve('.cache/pg-lab.json');
const cmd = process.argv[2];
const run = (name, args) =>
  execFileSync(path.join(bin, `${name}.exe`), args, {
    windowsHide: true,
    encoding: 'utf8',
    stdio: 'ignore',
  });
if (cmd === 'init') {
  try {
    await access(configFile);
    throw new Error('Lab config already exists. Use start; no existing data is overwritten.');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  await mkdir('.data', { recursive: true });
  const password = randomBytes(32).toString('hex');
  const pwfile = path.resolve('.cache/pg-init-password');
  await writeFile(pwfile, password, { mode: 0o600 });
  console.log(
    run('initdb', [
      '-D',
      data,
      '-U',
      'frontier_admin',
      '--pwfile',
      pwfile,
      '--auth=scram-sha-256',
      '--encoding=UTF8',
      '--locale=C',
    ]),
  );
  await writeFile(pwfile, '', { mode: 0o600 });
  await writeFile(configFile, JSON.stringify({ password, port: 55432 }), { mode: 0o600 });
}
const config = JSON.parse(await readFile(configFile, 'utf8'));
const url = (db, role = 'frontier_app') =>
  `postgresql://${role}:${config.password}@127.0.0.1:${config.port}/${db}`;
if (cmd === 'init' || cmd === 'start') {
  try {
    console.log(run('pg_ctl', ['-D', data, 'status']));
  } catch {
    console.log(
      run('pg_ctl', [
        '-D',
        data,
        '-l',
        path.resolve('.data/pg17.log'),
        '-o',
        `-h 127.0.0.1 -p ${config.port}`,
        '-w',
        'start',
      ]),
    );
  }
}
if (cmd === 'init' || cmd === 'create') {
  const client = new pg.Client({ connectionString: url('postgres', 'frontier_admin') });
  await client.connect();
  if (!(await client.query("SELECT 1 FROM pg_roles WHERE rolname='frontier_app'")).rowCount)
    await client.query('CREATE ROLE frontier_app LOGIN PASSWORD ' + "'" + config.password + "'");
  for (const name of [
    'frontier_acceptance_v011',
    'frontier_restore_v011',
    'frontier_tests_v011',
    'frontier_hardening_v011',
    'frontier_tests_restore_v011',
  ]) {
    if (!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount)
      await client.query(`CREATE DATABASE ${name} OWNER frontier_app`);
  }
  console.log((await client.query('SELECT version()')).rows[0]);
  await client.end();
}
if (cmd === 'reset-tests') {
  const client = new pg.Client({ connectionString: url('postgres', 'frontier_admin') });
  await client.connect();
  for (const name of [
    'frontier_tests_v011',
    'frontier_tests_restore_v011',
    'frontier_hardening_v011',
  ]) {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name} OWNER frontier_app`);
  }
  await client.end();
  console.log('Only three explicitly named disposable test databases recreated.');
}
if (cmd === 'stop') console.log(run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']));
if (cmd === 'run') {
  const db = process.argv[3];
  if (
    ![
      'frontier_acceptance_v011',
      'frontier_restore_v011',
      'frontier_tests_v011',
      'frontier_hardening_v011',
      'frontier_tests_restore_v011',
    ].includes(db)
  )
    throw new Error('Unknown lab database');
  const llmAcceptanceCallCap = process.env.LLM_ACCEPTANCE_MAX_CALLS ?? '8';
  const child = spawn(process.execPath, process.argv.slice(4), {
    windowsHide: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: url(db),
      TEST_POSTGRES_URL: url('frontier_tests_v011'),
      TEST_RESTORE_URL: url('frontier_tests_restore_v011'),
      TEST_HARDENING_URL: url('frontier_hardening_v011'),
      APP_ORIGIN: 'http://127.0.0.1:3101',
      TEST_BASE_URL: 'http://127.0.0.1:3101',
      LLM_ACCEPTANCE_MAX_CALLS: llmAcceptanceCallCap,
      LLM_MAX_CALLS_PER_DAY: llmAcceptanceCallCap,
    },
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}
