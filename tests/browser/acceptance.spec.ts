import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const origin = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100';
// The gate derives these expectations from independently collected source evidence.
// Controlled success and rate-limit runs use separate fresh databases; no runtime mock.
const expectedDecision = process.env.AFI_EXPECT_DECISION || 'INTEGRATE';
const expectedSource = process.env.AFI_EXPECT_SOURCE || 'AVAILABLE';
if (!['INTEGRATE', 'WAIT'].includes(expectedDecision))
  throw new Error('Invalid decision expectation');
if (!['AVAILABLE', 'RATE_LIMITED', 'ERROR', 'PARTIAL', 'UNAVAILABLE'].includes(expectedSource))
  throw new Error('Invalid source expectation');
test('full requested journey: home → concept → tool → compare → build → sources → profile → For You', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '动手之前，先看清前沿。' })).toBeVisible();
  await page.getByRole('textbox', { name: 'What do you want to understand?' }).fill('长期记忆');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page).toHaveURL(/search\?q=/);
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Long-Term Memory', exact: true }) })
    .click();
  await expect(page).toHaveURL(/concept\/long-term-memory/);
  await expect(page.getByRole('heading', { name: '工作原理', exact: true })).toBeVisible();
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Mem0', exact: true }) })
    .click();
  await expect(page).toHaveURL(/tool\/mem0/);
  await expect(page.getByRole('heading', { name: 'Evidence ledger' })).toBeVisible();
  await page.getByRole('link', { name: '加入比较视图' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Graphiti/ })).toBeVisible();
  await page.getByRole('link', { name: 'Build or Buy', exact: true }).click();
  await page.getByRole('button', { name: '评估已有方案' }).click();
  await expect(page.getByRole('heading', { name: expectedDecision, exact: true })).toBeVisible();
  if (expectedDecision === 'INTEGRATE')
    await expect(
      page.getByRole('link', { name: '@mem0/openclaw-mem0', exact: true }),
    ).toBeVisible();
  else await expect(page.getByRole('heading', { name: 'INTEGRATE', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '证据与来源', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Mem0 · GitHub metadata' }).click();
  if (expectedSource === 'AVAILABLE')
    await expect(page.locator('details[open]').getByText('license', { exact: true })).toBeVisible();
  else await expect(page.locator('details[open]')).toContainText(expectedSource);
  await page.getByRole('link', { name: '设置与技术档案' }).click();
  await page.getByLabel('邮箱', { exact: true }).fill(`browser-${randomUUID()}@example.test`);
  await page.getByLabel('密码 · 至少 12 个字符').fill('test-only-password-2026!');
  await page.getByRole('button', { name: '创建账户', exact: true }).last().click();
  await expect(page.getByText('已登录 · 独立档案')).toBeVisible();
  await page.getByLabel('Uses · 正在使用').fill('OpenClaw, Windows');
  await page.getByLabel('Interested In · 感兴趣').fill('长期记忆, MCP');
  await page.getByLabel('Building · 正在开发').fill('给 OpenClaw 选择长期记忆方案');
  await page.getByRole('button', { name: '保存技术档案' }).click();
  await expect(page.getByRole('status')).toContainText('技术档案已保存');
  await page.getByRole('link', { name: '工作台', exact: true }).click();
  await expect(page.locator('.for-you')).toContainText('Long-Term Memory');
  await expect(page.locator('.for-you')).toContainText('HIGH');
  await page.reload();
  await expect(page.locator('.for-you')).toContainText('Long-Term Memory');
  await page.screenshot({
    caret: 'initial',
    path: 'test-results/dashboard-desktop.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test('unknown searches and historic snapshots do not invent data', async ({ page }) => {
  await page.goto('/search?q=not-a-known-technology-xyz');
  await expect(page.getByText('UNAVAILABLE · 还没有足够证据')).toBeVisible();
  await page.goto('/concept/long-term-memory?at=2020-01-01');
  await expect(
    page.getByText('历史快照 2020-01-01：只显示当时已收录的事实；概念解释仍为当前编辑分析。'),
  ).toBeVisible();
  await expect(page.locator('.event-row')).toHaveCount(0);
});
test('Edge 834×1112 responsive viewport: critical views fit without horizontal page overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 834, height: 1112 });
  for (const url of ['/', '/concept/long-term-memory', '/compare', '/build', '/settings']) {
    await page.goto(url);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await page.goto('/');
  await page.screenshot({
    caret: 'initial',
    path: 'test-results/dashboard-ipad.png',
    fullPage: true,
  });
});
test('mobile navigation and responsive layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '切换导航' }).click();
  await page.getByRole('link', { name: 'Frontier Radar' }).click();
  await expect(page.getByRole('heading', { name: 'AI Frontier Radar' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    caret: 'initial',
    path: 'test-results/radar-mobile.png',
    fullPage: true,
  });
});
test('API validates input and rejects unauthenticated or cross-origin mutations', async ({
  request,
}) => {
  expect((await request.get('/api/health')).status()).toBe(200);
  expect((await request.get('/api/search?q=')).status()).toBe(400);
  expect(
    (await request.post('/api/context', { data: {}, headers: { Origin: origin } })).status(),
  ).toBe(401);
  expect(
    (
      await request.post('/api/context', {
        data: {},
        headers: { Origin: 'https://untrusted.example' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/auth/register', {
        data: { email: 'not-email', password: 'short' },
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post('/api/auth/register', {
        data: { email: 'oversize@example.test', password: 'x'.repeat(20000) },
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(413);
  expect((await request.get('/api/card?slug=missing')).status()).toBe(404);
  expect((await request.get('/api/card?slug=long-term-memory&at=not-date')).status()).toBe(400);
  const search = await (await request.get('/api/search?q=长期记忆')).json();
  expect(search.matches[0].entity.slug).toBe('long-term-memory');
  expect(search.stages.length).toBe(14);
});
test('two authenticated users cannot read or overwrite each other profiles', async ({
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
    for (const client of [a, b])
      expect(
        (
          await client.post('/api/auth/register', {
            data: {
              email: `api-${randomUUID()}@example.test`,
              password: 'test-only-password-2026!',
            },
          })
        ).status(),
      ).toBe(200);
    const meA = await (await a.get('/api/me')).json();
    await a.post('/api/context', {
      data: { uses: ['Private-A'], interests: ['MCP'], building: 'A only', learned: [] },
    });
    await b.post('/api/context', {
      data: {
        user_id: meA.user.id,
        uses: ['Private-B'],
        interests: ['RAG'],
        building: 'B only',
        learned: [],
      },
    });
    expect((await (await a.get('/api/me')).json()).context.building).toBe('A only');
    expect((await (await b.get('/api/me')).json()).context.building).toBe('B only');
    await a.post('/api/auth/logout', { data: {} });
    expect((await (await a.get('/api/me')).json()).user).toBeNull();
  } finally {
    await a.dispose();
    await b.dispose();
  }
});
