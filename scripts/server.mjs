// A dedicated entry point lets HTTP requests drain before closing the database.
import http from 'node:http';
import next from 'next';
process.env.NODE_ENV ??= 'production';
process.env.NEXT_MANUAL_SIG_HANDLE = 'true';
const app = next({ dev: false, hostname: '127.0.0.1', port: Number(process.env.PORT || 3100) });
await app.prepare();
const handler = app.getRequestHandler();
const server = http.createServer((req, res) => {
  void handler(req, res);
});
let closing;
async function shutdown() {
  if (closing) return closing;
  closing = (async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (!globalThis.frontierShutdown) throw new Error('knowfirst shutdown hook is missing');
    await globalThis.frontierShutdown();
    await app.close();
  })();
  return closing;
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void shutdown().then(
      () => {
        process.exitCode = 0;
      },
      () => {
        console.error('knowfirst shutdown failed; inspect retained database lock before restart.');
        process.exitCode = 1;
      },
    );
  });
// IPC is used by isolated Windows restart tests, where OS signal delivery differs.
process.on('message', (message) => {
  if (message === 'shutdown') void shutdown().then(() => process.disconnect?.());
});
server.listen(Number(process.env.PORT || 3100), '127.0.0.1', () => console.log('knowfirst server ready'));
