import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const origin = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
test('reauthenticated personal purge and account deletion revoke all sessions', async ({
  playwright,
}) => {
  const a = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const b = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  try {
    const credentials = {
      email: `erase-${randomUUID()}@example.test`,
      password: 'test-only-deletion-password!',
    };
    expect((await a.post('/api/auth/register', { data: credentials })).status()).toBe(200);
    expect((await b.post('/api/auth/login', { data: credentials })).status()).toBe(200);
    expect(
      (
        await a.post('/api/context', {
          data: { uses: ['private'], interests: ['MCP'], building: 'delete me', learned: [] },
        })
      ).status(),
    ).toBe(200);
    expect((await a.post('/api/privacy/clear', { data: { password: 'wrong' } })).status()).toBe(
      401,
    );
    expect(
      (await a.post('/api/privacy/clear', { data: { password: credentials.password } })).status(),
    ).toBe(200);
    expect((await (await a.get('/api/me')).json()).context.building).toBe('');
    expect(
      (await a.post('/api/auth/delete', { data: { password: credentials.password } })).status(),
    ).toBe(200);
    expect((await (await b.get('/api/me')).json()).user).toBe(null);
    expect(
      (
        await b.post('/api/context', {
          data: { uses: [], interests: [], building: 'resurrection', learned: [] },
        })
      ).status(),
    ).toBe(401);
  } finally {
    await a.dispose();
    await b.dispose();
  }
});
test('model opt-in endpoint requires auth while browsing remains available', async ({
  request,
}) => {
  expect(
    (
      await request.post('/api/llm', {
        headers: { Origin: origin },
        data: { task: 'research', query: 'Mem0' },
      })
    ).status(),
  ).toBe(401);
  expect((await request.get('/api/card?slug=mem0')).status()).toBe(200);
  expect((await request.get('/api/build?q=OpenClaw%20memory')).status()).toBe(200);
});
