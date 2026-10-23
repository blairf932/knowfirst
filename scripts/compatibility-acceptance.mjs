import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
process.env.OPENCLAW_STATE_DIR = path.resolve('.cache/compatibility/state');
await mkdir(process.env.OPENCLAW_STATE_DIR, { recursive: true });
// No service keys are loaded and no external requests are permitted by this limited harness.
globalThis.fetch = async () => {
  throw new Error('NETWORK_DISABLED_IN_COMPONENT_HARNESS');
};
const results = [];
for (const name of ['@mem0/openclaw-mem0', '@supermemory/openclaw-supermemory']) {
  const root = path.resolve('.cache/compatibility/node_modules', name);
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const result = {
    package: name,
    version: pkg.version,
    declaredHost: pkg.openclaw.compat,
    install: 'PASS',
    moduleLoad: 'NOT_TESTED',
    componentFailure: 'NOT_TESTED',
    hostStartup: 'BLOCKED',
    memoryWrite: 'BLOCKED',
    memoryRecall: 'BLOCKED',
    memoryUpdate: 'BLOCKED',
    restartPersistence: 'BLOCKED',
    level: 'DECLARED',
    notes:
      'Component harness is not a real OpenClaw host. Separate Mem0/Supermemory service credentials and provisioned storage absent; DeepSeek API key is not a memory-service credential.',
  };
  const logs = [];
  const commands = [];
  try {
    const plugin = (await import(pathToFileURL(path.join(root, 'dist/index.js')).href)).default;
    result.moduleLoad = 'PASS';
    try {
      await plugin.register({
        pluginConfig: {},
        logger: {
          info: (m) => logs.push(String(m)),
          warn: (m) => logs.push(String(m)),
          error: (m) => logs.push(String(m)),
          debug: () => {},
        },
        registerCli: () => {},
        registerCommand: (c) => commands.push(c),
        runtime: {},
      });
      result.componentFailure = logs.some((l) => /not configured|api.key|required|setup/i.test(l))
        ? 'PASS'
        : 'PARTIAL';
    } catch (e) {
      result.componentFailure = /config|required|key/i.test(e.message) ? 'PASS' : 'PARTIAL';
      result.errorType = e.name;
      result.errorCode = e.code ?? null;
    }
  } catch (e) {
    result.moduleLoad = 'FAIL';
    result.errorType = e.name;
    result.errorCode = e.code ?? null;
  }
  results.push({ ...result, registeredStubCommands: commands.map((c) => c.name) });
}
await writeFile(
  'docs/COMPATIBILITY_ACCEPTANCE.json',
  JSON.stringify(
    {
      checked_at: new Date().toISOString(),
      environment: {
        os: process.platform,
        node: process.version,
        host: 'component harness; NOT an installed OpenClaw host',
      },
      results,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(results, null, 2));
