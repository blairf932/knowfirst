import { loadEnvFile } from 'node:process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
try {
  loadEnvFile('.env');
} catch {}
const { database, closeDatabase } = await import('../lib/db');
const { seed } = await import('../lib/seed');
const { refreshSources } = await import('../lib/ingestion');
const { exportBackup, restoreBackup } = await import('../lib/backup');
const command = process.argv[2];
try {
  const db = await database();
  if (command === 'migrate') console.log('Database migrations applied.');
  else if (command === 'seed') {
    await seed();
    console.log('Catalog seeded. No external facts invented. Run radar:refresh to collect.');
  } else if (command === 'refresh') {
    await seed();
    console.log(JSON.stringify(await refreshSources(process.argv[3]), null, 2));
  } else if (command === 'backup') {
    const payload = await exportBackup(db);
    await mkdir('backups', { recursive: true });
    const file = path.resolve('backups', `frontier-${Date.now()}.json`);
    await writeFile(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
    console.log(
      `Sensitive local logical backup saved: ${file}. Protect and encrypt it before off-device storage.`,
    );
  } else if (command === 'restore') {
    if (!process.argv[3])
      throw new Error('Provide the backup file path. Destination must be empty.');
    console.log(
      JSON.stringify(await restoreBackup(db, JSON.parse(await readFile(process.argv[3], 'utf8')))),
    );
  } else throw new Error('Use migrate, seed, refresh, backup or restore');
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
