import { access, cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const requiredRuntime = 'next/dist/compiled/next-server/app-route-turbo.runtime.prod.js';
const acceptancePath = 'docs/RELEASE_RUNTIME_ACCEPTANCE.json';
const incompleteAcceptance = {
  generatedAt: new Date().toISOString(),
  status: 'FAIL',
  failure: { phase: 'INITIALIZATION', code: 'GATE_DID_NOT_COMPLETE' },
};
// Overwrite any previous PASS before doing work. Only a completed gate may restore PASS.
await writeFile(acceptancePath, JSON.stringify(incompleteAcceptance, null, 2) + '\n');
const projectRoot = await realpath(process.cwd());
const artifact = await realpath((await readFile('.cache/release-path.txt', 'utf8')).trim());
const distRoot = await realpath(path.join(projectRoot, 'dist'));
const lockHash = createHash('sha256')
  .update(await readFile('package-lock.json'))
  .digest('hex');
const buildId = (await readFile(path.join(artifact, '.next', 'BUILD_ID'), 'utf8')).trim();
const artifactPackage = JSON.parse(await readFile(path.join(artifact, 'package.json'), 'utf8'));
const projectPackage = JSON.parse(await readFile('package.json', 'utf8'));
const artifactReport = JSON.parse(await readFile('docs/release-artifact.json', 'utf8'));

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

if (!isWithin(distRoot, artifact) || artifact === distRoot)
  throw new Error('Invalid release artifact path');
if (!process.env.DATABASE_URL)
  throw new Error('The isolated release gate requires standard PostgreSQL');
let databaseName;
try {
  databaseName = new URL(process.env.DATABASE_URL).pathname.replace(/^\/+/, '');
} catch {
  throw new Error('DATABASE_URL is invalid');
}
if (databaseName !== 'frontier_restore_v011')
  throw new Error('The isolated release gate requires the restored PostgreSQL database');
const injectedNodeEnvironment = ['NODE_PATH', 'NODE_OPTIONS'].filter((key) => process.env[key]);
if (injectedNodeEnvironment.length)
  throw new Error(`External Node injection is not allowed: ${injectedNodeEnvironment.join(', ')}`);

const systemTempRoot = await realpath(tmpdir());
if (isWithin(projectRoot, systemTempRoot))
  throw new Error('Release gate isolation directory must be outside the project tree');
const portNumber = Number(process.env.RELEASE_GATE_PORT || '3101');
if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535)
  throw new Error('RELEASE_GATE_PORT must be a valid TCP port');
const isolationRoot = await realpath(
  await mkdtemp(path.join(systemTempRoot, 'ai-frontier-release-gate-')),
);
const isolatedArtifact = path.join(isolationRoot, 'release');
const port = String(portNumber);
const origin = `http://127.0.0.1:${port}`;
let server;
let browser;
let runtimeAcceptance;
let gatePhase = 'ARTIFACT_IDENTITY';

const phaseFailureCodes = {
  ARTIFACT_IDENTITY: 'ARTIFACT_IDENTITY_INVALID',
  ISOLATION_POLICY: 'ISOLATION_POLICY_FAILED',
  ARTIFACT_COPY: 'ARTIFACT_COPY_FAILED',
  RUNTIME_DEPENDENCY: 'REQUIRED_RUNTIME_UNAVAILABLE',
  PORT_AVAILABILITY: 'PORT_UNAVAILABLE',
  SERVER_STARTUP: 'SERVER_STARTUP_FAILED',
  DYNAMIC_API: 'DYNAMIC_API_CONTRACT_FAILED',
  BROWSER_ACCEPTANCE: 'BROWSER_ACCEPTANCE_FAILED',
};

function failedAcceptance(phase, code = phaseFailureCodes[phase] ?? 'GATE_FAILED', detail) {
  return {
    generatedAt: new Date().toISOString(),
    status: 'FAIL',
    failure: { phase, code, ...(detail ? { detail } : {}) },
  };
}

function cleanSystemEnvironment() {
  const allowed = new Set(['SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'TZ', 'WINDIR']);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && allowed.has(key.toUpperCase()),
    ),
  );
}

async function verifyCleanAncestors(start) {
  let current = start;
  let checked = 0;
  while (true) {
    let exists = true;
    try {
      await access(path.join(current, 'node_modules'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      exists = false;
    }
    if (exists) throw new Error(`Release isolation ancestor contains node_modules: ${current}`);
    checked += 1;
    const parent = path.dirname(current);
    if (parent === current) return checked;
    current = parent;
  }
}

function withoutNodeInjection(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !['NODE_OPTIONS', 'NODE_PATH'].includes(key.toUpperCase()),
    ),
  );
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForExit(child);
  if (child.connected) child.send('shutdown');
  else child.kill('SIGTERM');
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, 20000, null);
  });
  const result = await Promise.race([exited, timeout]);
  clearTimeout(timer);
  if (result === null) {
    child.kill('SIGKILL');
    await exited;
    throw new Error('Graceful shutdown timed out');
  }
  if (result.code !== 0) throw new Error('Graceful shutdown returned a nonzero exit');
}

async function findRuntimeImporter() {
  const chunks = path.join(isolatedArtifact, '.next', 'server', 'chunks');
  for (const entry of await readdir(chunks, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const candidate = path.join(chunks, entry.name);
    if ((await readFile(candidate, 'utf8')).includes(requiredRuntime)) return candidate;
  }
  throw new Error('Built API chunks do not import the required App Route runtime');
}

async function fetchJson(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${new URL(url).pathname} did not return JSON`);
  }
  return { response, body };
}

async function waitUntilListening(exitPromise) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      const result = await exitPromise;
      throw new Error(`Isolated release exited before readiness (${result.code ?? result.signal})`);
    }
    try {
      const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) return;
      throw new Error(`GET / returned HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('GET / returned')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('Isolated release did not become ready within 30 seconds');
}

async function assertPortAvailable() {
  try {
    await fetch(`${origin}/`, { signal: AbortSignal.timeout(500) });
  } catch {
    return;
  }
  throw new Error(`Release gate port ${port} is already in use`);
}

let restartCredentials;
async function smokeTest() {
  const home = await fetch(`${origin}/`, { signal: AbortSignal.timeout(10000) });
  if (home.status !== 200) throw new Error(`GET / returned HTTP ${home.status}`);

  const health = await fetchJson(`${origin}/api/health`);
  if (
    health.response.status !== 200 ||
    health.body.status !== 'AVAILABLE' ||
    health.body.database !== 'PostgreSQL' ||
    health.body.version !== '0.1.1'
  )
    throw new Error('GET /api/health failed the release contract');

  const anonymous = await fetchJson(`${origin}/api/me`);
  if (anonymous.response.status !== 200 || anonymous.body.user !== null)
    throw new Error('Anonymous GET /api/me failed the release contract');

  const email = `release-gate-${randomUUID()}@example.test`;
  const password = `release-gate-${randomUUID()}-A1!`;
  restartCredentials = { email, password };
  const registration = await fetchJson(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, password }),
  });
  const setCookies = registration.response.headers.getSetCookie();
  const session = setCookies
    .find((cookie) => cookie.startsWith('frontier_session='))
    ?.split(';', 1)[0];
  if (
    registration.response.status !== 200 ||
    registration.body.status !== 'AVAILABLE' ||
    registration.body.user?.email !== email ||
    !session
  )
    throw new Error('POST /api/auth/register failed the release contract');

  const authenticated = await fetchJson(`${origin}/api/me`, {
    headers: { Cookie: session },
  });
  if (
    authenticated.response.status !== 200 ||
    authenticated.body.user?.id !== registration.body.user.id ||
    authenticated.body.user?.email !== email
  )
    throw new Error('Authenticated GET /api/me failed the release contract');

  return {
    home: { httpStatus: home.status, businessAssertion: 'PAGE_SERVED', pass: true },
    health: {
      httpStatus: health.response.status,
      status: health.body.status,
      database: health.body.database,
      version: health.body.version,
      pass: true,
    },
    anonymousMe: {
      httpStatus: anonymous.response.status,
      anonymousUser: anonymous.body.user === null,
      pass: true,
    },
    registration: {
      httpStatus: registration.response.status,
      status: registration.body.status,
      userMatched: true,
      sessionCookie: true,
      pass: true,
    },
    authenticatedMe: {
      httpStatus: authenticated.response.status,
      userMatched: true,
      pass: true,
    },
  };
}

try {
  gatePhase = 'ARTIFACT_IDENTITY';
  if (
    artifactReport.artifactDirectory !== path.basename(artifact) ||
    artifactReport.version !== artifactPackage.version ||
    artifactPackage.version !== projectPackage.version ||
    artifactReport.lockHash !== lockHash ||
    artifactReport.buildId !== buildId
  )
    throw new Error('Release artifact identity does not match its report and current project');
  gatePhase = 'ISOLATION_POLICY';
  const checkedAncestorCount = await verifyCleanAncestors(isolationRoot);
  gatePhase = 'ARTIFACT_COPY';
  await cp(artifact, isolatedArtifact, { recursive: true, dereference: true });
  gatePhase = 'RUNTIME_DEPENDENCY';
  const importer = await findRuntimeImporter();
  const resolvedRuntime = await realpath(createRequire(importer).resolve(requiredRuntime));
  if (!isWithin(isolatedArtifact, resolvedRuntime))
    throw new Error('Required App Route runtime resolved outside the isolated artifact');

  const erasureLedger = path.join(isolationRoot, 'runtime-data', 'erasure-ledger.jsonl');
  const runtimeEnvironment = {
    ...cleanSystemEnvironment(),
    PORT: port,
    HOSTNAME: '127.0.0.1',
    APP_ORIGIN: origin,
    DATABASE_URL: process.env.DATABASE_URL,
    ALLOW_REGISTRATION: 'true',
    REQUIRE_STANDARD_POSTGRES: 'true',
    SCHEDULER_ENABLED: 'false',
    ERASURE_LEDGER_PATH: erasureLedger,
    LLM_PROVIDER: 'disabled',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  gatePhase = 'PORT_AVAILABILITY';
  await assertPortAvailable();
  gatePhase = 'SERVER_STARTUP';
  server = spawn(
    process.execPath,
    ['--no-global-search-paths', path.join(isolatedArtifact, 'server.js')],
    {
      cwd: isolatedArtifact,
      windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: runtimeEnvironment,
    },
  );
  const serverExit = waitForExit(server);
  await waitUntilListening(serverExit);
  gatePhase = 'DYNAMIC_API';
  const api = await smokeTest();

  gatePhase = 'BROWSER_ACCEPTANCE';
  const projectNodeModules = await realpath(path.join(projectRoot, 'node_modules'));
  const playwrightCli = await realpath(
    createRequire(import.meta.url).resolve('@playwright/test/cli'),
  );
  if (!isWithin(projectNodeModules, playwrightCli))
    throw new Error('Playwright CLI resolved outside project node_modules');
  const browserEnvironment = withoutNodeInjection({
    ...process.env,
    TEST_BASE_URL: origin,
    CI: '1',
  });
  browser = spawn(
    process.execPath,
    [
      '--no-global-search-paths',
      playwrightCli,
      'test',
      '--config',
      path.join(projectRoot, 'playwright.config.ts'),
    ],
    {
      cwd: projectRoot,
      windowsHide: true,
      stdio: 'inherit',
      env: browserEnvironment,
    },
  );
  const browserExit = waitForExit(browser);
  const firstExit = await Promise.race([
    browserExit.then((result) => ({ process: 'browser', ...result })),
    serverExit.then((result) => ({ process: 'server', ...result })),
  ]);
  if (firstExit.process === 'server')
    throw new Error(
      `Isolated release exited during Browser tests (${firstExit.code ?? firstExit.signal})`,
    );
  if (firstExit.code !== 0)
    throw new Error(`Browser acceptance failed (${firstExit.code ?? firstExit.signal})`);
  if (server.exitCode !== null || server.signalCode !== null)
    throw new Error('Isolated release exited before the gate completed');

  gatePhase = 'GRACEFUL_RESTART';
  await stop(server);
  server = spawn(
    process.execPath,
    ['--no-global-search-paths', path.join(isolatedArtifact, 'server.js')],
    {
      cwd: isolatedArtifact,
      windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: runtimeEnvironment,
    },
  );
  await waitUntilListening(waitForExit(server));
  const login = await fetchJson(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(restartCredentials),
  });
  if (login.response.status !== 200 || login.body.user?.email !== restartCredentials.email)
    throw new Error('Restart did not preserve the account');
  await stop(server);
  const restartedHealth = await fetchJson(`${origin}/api/health`).then(
    () => true,
    () => false,
  );
  if (restartedHealth) throw new Error('Server still responds after graceful shutdown');

  runtimeAcceptance = {
    generatedAt: new Date().toISOString(),
    status: 'PASS',
    sourceMode: process.env.AFI_SOURCE_MODE || 'UNSPECIFIED',
    sourceProvenance:
      process.env.AFI_SOURCE_MODE === 'live' ? 'LIVE_EXTERNAL' : 'SIMULATED_SOURCE_RESPONSES',
    expectedDecision: process.env.AFI_EXPECT_DECISION || 'INTEGRATE',
    gracefulRestart: { shutdownExit: 0, loginAfterRestart: 'PASS', finalPortClosed: true },
    artifact: {
      directory: path.basename(artifact),
      version: artifactPackage.version,
      buildId,
      lockHash,
      packageReportGeneratedAt: artifactReport.generated_at,
    },
    isolation: {
      directoryKind: 'OS_TEMP',
      isolatedOutsideProject: true,
      ancestorNodeModules: 'ABSENT',
      checkedAncestorCount,
      NODE_PATH: 'ABSENT',
      NODE_OPTIONS: 'ABSENT',
      path: 'NOT_RETAINED_AFTER_GATE',
    },
    runtime: {
      resolvedModule: requiredRuntime,
      resolvedInsideArtifact: true,
      resolvedPath: path.relative(isolatedArtifact, resolvedRuntime),
      externalCodeInjection: 'ABSENT',
      globalSearchPaths: 'DISABLED',
    },
    api,
    browser: {
      command:
        'node --no-global-search-paths node_modules/@playwright/test/cli.js test --config playwright.config.ts',
      cliResolvedInsideProject: true,
      channel: 'msedge',
      scope: 'ALL_CONFIGURED_TESTS',
      status: 'PASS',
    },
    database: { type: api.health.database, name: databaseName },
  };
} catch (error) {
  const detail = error instanceof Error ? error.message.slice(0, 500) : 'Unknown gate error';
  console.error(`[release-gate:${gatePhase}] ${detail}`);
  runtimeAcceptance = failedAcceptance(gatePhase, undefined, detail);
  process.exitCode = 1;
} finally {
  let cleanupFailed = false;
  try {
    await stop(browser);
  } catch {
    cleanupFailed = true;
  }
  try {
    await stop(server);
  } catch {
    cleanupFailed = true;
  }
  const safeIsolationTarget =
    !isWithin(projectRoot, isolationRoot) &&
    isWithin(systemTempRoot, isolationRoot) &&
    path.basename(isolationRoot).startsWith('ai-frontier-release-gate-');
  if (safeIsolationTarget) {
    try {
      await rm(isolationRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      cleanupFailed = true;
    }
  } else {
    cleanupFailed = true;
  }
  if (cleanupFailed) {
    process.exitCode = 1;
    if (runtimeAcceptance?.status === 'FAIL') {
      runtimeAcceptance.cleanup = { status: 'FAIL', code: 'ISOLATION_CLEANUP_FAILED' };
    } else {
      runtimeAcceptance = failedAcceptance('CLEANUP', 'ISOLATION_CLEANUP_FAILED');
    }
  }
}

await writeFile(acceptancePath, JSON.stringify(runtimeAcceptance, null, 2) + '\n');
const gateSummary = JSON.stringify({
  status: runtimeAcceptance.status,
  evidence: acceptancePath,
  ...(runtimeAcceptance.failure ? { failure: runtimeAcceptance.failure } : {}),
});
if (runtimeAcceptance.status === 'PASS') console.log(gateSummary);
else console.error(gateSummary);
