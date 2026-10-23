import { fork } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const mode = process.argv[2];
if (mode === 'worker') {
  const { database, closeDatabase } = await import('../lib/db.ts');
  try {
    const db = await database();
    await db.exec('CREATE TABLE IF NOT EXISTS process_probe(n integer)');
    const before = (await db.query('SELECT count(*)::int n FROM process_probe')).rows[0].n;
    if (process.argv[3] === 'hold') {
      process.send?.({ ready: true });
      await new Promise((resolve) => process.once('message', resolve));
    } else {
      assert.equal(before, Number(process.argv[3]));
      await db.query('INSERT INTO process_probe VALUES($1)', [before]);
    }
    await closeDatabase();
    process.disconnect?.();
  } catch (e) {
    console.error(e instanceof Error ? e.stack : e);
    process.exitCode = 1;
    process.disconnect?.();
  }
} else {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'afi-process-probe-'));
  const env = {
    ...process.env,
    PGLITE_DIR: dir,
    SCHEDULER_ENABLED: 'false',
    LLM_PROVIDER: 'disabled',
  };
  for (const key of Object.keys(env))
    if (/^(DATABASE_URL|TEST_.*URL|LLM_API_KEY|GITHUB_TOKEN|REQUIRE_STANDARD_POSTGRES)$/.test(key))
      delete env[key];
  const spawn = (n) =>
    fork(new URL(import.meta.url), ['worker', String(n)], {
      env,
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
  const finish = (child) =>
    new Promise((resolve, reject) => {
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Isolated child timed out'));
      }, 30000);
      child.on('error', reject);
      child.on('exit', (code) => {
        clearTimeout(timeout);
        resolve({ code, out });
      });
    });
  try {
    for (let i = 0; i < 8; i++) {
      const result = await finish(spawn(i));
      assert.equal(result.code, 0, result.out);
      await assert.rejects(access(path.join(dir, '.frontier.lock')), { code: 'ENOENT' });
      console.log(`process restart ${i + 1}: PASS`);
    }
    const owner = spawn('hold');
    const done = finish(owner);
    await new Promise((resolve, reject) => {
      owner.once('message', resolve);
      owner.once('exit', () => reject(new Error('Owner exited early')));
    });
    const rival = await finish(spawn(8));
    assert.equal(rival.code, 1);
    assert.match(rival.out, /already open/);
    owner.send('close');
    assert.equal((await done).code, 0);
    const final = await finish(spawn(8));
    assert.equal(final.code, 0, final.out);
    console.log('cross-process active lock refusal and recovery: PASS');
  } finally {
    assert.ok(path.basename(dir).startsWith('afi-process-probe-'));
    await rm(dir, { recursive: true, force: true });
  }
}
