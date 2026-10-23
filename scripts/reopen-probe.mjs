import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const mode = process.argv[2] || 'native';
const dir = await mkdtemp(path.join(os.tmpdir(), 'afi-reopen-'));
delete process.env.DATABASE_URL;
process.env.PGLITE_DIR = dir;
const { database, closeDatabase } = await import('../lib/db.ts');
try {
  for (let i = 0; i < 10; i++) {
    const db = mode === 'native' ? new PGlite(dir, { debug: 1 }) : await database();
    if (mode === 'native') await db.waitReady;
    await db.exec('CREATE TABLE IF NOT EXISTS reopen_probe(n integer)');
    const before = await db.query('SELECT count(*)::int n FROM reopen_probe');
    if (before.rows[0].n !== i) throw new Error(`Lost persistence at ${i}`);
    await db.query('INSERT INTO reopen_probe VALUES ($1)', [i]);
    if (mode === 'native') await db.close();
    else await closeDatabase();
    console.log(JSON.stringify({ mode, cycle: i + 1, status: 'PASS' }));
  }
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  await closeDatabase();
  await rm(dir, { recursive: true, force: true });
}
