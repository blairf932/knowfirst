import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { database, closeDatabase } from '../lib/db';
const root = await mkdtemp(path.join(os.tmpdir(), 'afi-lifecycle-faults-'));
const original = process.cwd();
delete process.env.DATABASE_URL;
process.env.PGLITE_DIR = path.join(root, 'data');
test('migration failure closes instance and releases owned lock, then retries cleanly', async () => {
  await mkdir(path.join(root, 'db', 'migrations'), { recursive: true });
  await writeFile(path.join(root, 'db', 'migrations', '001.sql'), 'INVALID SQL;');
  process.chdir(root);
  await assert.rejects(database(), /syntax error/);
  await assert.rejects(access(path.join(root, 'data', '.frontier.lock')), { code: 'ENOENT' });
  await writeFile(
    path.join(root, 'db', 'migrations', '001.sql'),
    'CREATE TABLE persisted(n integer);',
  );
  const db = await database();
  await db.exec('INSERT INTO persisted VALUES(7)');
  await closeDatabase();
  const reopened = await database();
  assert.equal((await reopened.query<{ n: number }>('SELECT n FROM persisted')).rows[0].n, 7);
  await closeDatabase();
  process.chdir(original);
});
test('existing lock is refused without deleting it or touching the database', async () => {
  const lock = path.join(root, 'data', '.frontier.lock');
  await writeFile(lock, 'external-owner');
  await assert.rejects(database(), /already open/);
  assert.equal(await readFile(lock, 'utf8'), 'external-owner');
  await rm(lock);
});
test('changed lock ownership is preserved and blocks reopen after failed close', async () => {
  const db = await database();
  const lock = path.join(root, 'data', '.frontier.lock');
  await writeFile(lock, 'replacement-created-by-this-test');
  await assert.rejects(closeDatabase(), /ownership changed/);
  assert.equal(await readFile(lock, 'utf8'), 'replacement-created-by-this-test');
  await assert.rejects(database(), /ownership changed/);
  await assert.rejects(db.query('SELECT 1'), /closing/);
});
test.after(async () => {
  process.chdir(original);
  // The last test closed the engine before the deliberately failed ownership check.
  assert.ok(path.basename(root).startsWith('afi-lifecycle-faults-'));
  await rm(root, { recursive: true, force: true });
});
