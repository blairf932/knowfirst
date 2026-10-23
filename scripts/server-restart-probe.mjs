import { fork } from 'node:child_process';
import { mkdtemp, rm, access, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import net from 'node:net';
const port = await new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const dir = await mkdtemp(path.join(os.tmpdir(), 'afi-server-restart-'));
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(port),
  APP_ORIGIN: origin,
  PGLITE_DIR: path.join(dir, 'db'),
  ERASURE_LEDGER_PATH: path.join(dir, 'erasure.jsonl'),
  SCHEDULER_ENABLED: 'false',
  LLM_PROVIDER: 'disabled',
  LLM_API_KEY: '',
  GITHUB_TOKEN: '',
};
for (const key of Object.keys(env))
  if (/^(DATABASE_URL|TEST_.*URL|REQUIRE_STANDARD_POSTGRES)$/.test(key)) delete env[key];
let server;
async function start() {
  server = fork('scripts/server.mjs', [], {
    env,
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  server.stdout.on('data', (d) => process.stdout.write(d));
  server.stderr.on('data', (d) => process.stderr.write(d));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}`);
    try {
      const r = await fetch(`${origin}/api/health`);
      if (r.ok) {
        assert.equal((await r.json()).status, 'AVAILABLE');
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Server readiness timed out');
}
async function stop() {
  const child = server;
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Graceful shutdown timed out')), 20000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Shutdown exit ${code}`));
    });
  });
  child.send('shutdown');
  await done;
  server = undefined;
  await assert.rejects(access(path.join(dir, 'db', '.frontier.lock')), { code: 'ENOENT' });
}
async function post(route, data) {
  const r = await fetch(origin + route, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  assert.equal(r.status, 200, await r.text());
}
try {
  await start();
  await post('/api/auth/register', {
    email: 'restart@example.test',
    password: 'isolated-restart-password!',
  });
  await stop();
  console.log('HTTP account created; graceful stop released lock: PASS');
  await start();
  await post('/api/auth/login', {
    email: 'restart@example.test',
    password: 'isolated-restart-password!',
  });
  await stop();
  console.log('built server restart retained account and authenticated: PASS');
} finally {
  if (server) {
    server.kill();
    await new Promise((r) => server.once('exit', r));
  }
  assert.ok(path.basename(dir).startsWith('afi-server-restart-'));
  await rm(dir, { recursive: true, force: true });
}
