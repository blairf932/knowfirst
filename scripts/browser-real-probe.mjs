import { fork, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
const dir = await mkdtemp(path.join(os.tmpdir(), 'afi-browser-real-'));
const port = await new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const n = s.address().port;
    s.close(() => resolve(n));
  });
});
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  PGLITE_DIR: path.join(dir, 'db'),
  ERASURE_LEDGER_PATH: path.join(dir, 'erasure.jsonl'),
  PORT: String(port),
  APP_ORIGIN: origin,
  TEST_BASE_URL: origin,
  NODE_ENV: 'production',
  SCHEDULER_ENABLED: 'false',
  LLM_PROVIDER: 'disabled',
  LLM_API_KEY: '',
  GITHUB_TOKEN: '',
  DATABASE_URL: '',
  REQUIRE_STANDARD_POSTGRES: '',
};
async function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', resolve);
  });
}
let server;
try {
  if (await cli(['--import', 'tsx', 'scripts/manage.ts', 'seed'])) throw new Error('Seed failed');
  // Only the public, credential-free source adapters are invoked. No model call.
  if (await cli(['--import', 'tsx', 'scripts/manage.ts', 'refresh']))
    throw new Error('Refresh command failed');
  server = fork('scripts/server.mjs', [], {
    env,
    execArgv: [],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(origin + '/api/health')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error('Server failed readiness');
  process.exitCode = await cli(['node_modules/@playwright/test/cli.js', 'test']);
} finally {
  if (server) {
    const child = server;
    const stopped = new Promise((resolve) => child.once('exit', resolve));
    child.send('shutdown');
    await stopped;
  }
  if (path.basename(dir).startsWith('afi-browser-real-'))
    await rm(dir, { recursive: true, force: true });
}
