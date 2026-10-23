import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database } from '@/lib/db';
import {
  sessionUser,
  hashPassword,
  verifyPassword,
  createSession,
  sessionCookie,
  digest,
  rateLimit,
  audit,
} from '@/lib/auth';
import { credentialsSchema, contextSchema, querySchema } from '@/lib/domain';
import { snapshot, userContext, buildDecision } from '@/lib/knowledge';
import { refreshSources } from '@/lib/ingestion';
import { research, frontierCard } from '@/lib/research';
import { groundedTask } from '@/lib/llm/tasks';
import { usageSummary } from '@/lib/llm/provider';
import { deleteAccount, purgePersonalHistory } from '@/lib/privacy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ path: string[] }> };
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function boundedBody(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.length;
    if (bytes > 16000) {
      await reader.cancel();
      throw new Error('BODY_TOO_LARGE');
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function handle(req: NextRequest, { params }: Ctx) {
  const requestId = randomUUID();
  try {
    const route = (await params).path.join('/');
    const db = await database();
    if (req.method === 'GET' && route === 'health') {
      await db.query('SELECT 1');
      return json({
        status: 'AVAILABLE',
        database: process.env.DATABASE_URL ? 'PostgreSQL' : 'PGlite PostgreSQL',
        version: '0.1.1',
      });
    }
    const origin = new URL(process.env.APP_ORIGIN || 'http://127.0.0.1:3100').origin;
    if (req.method !== 'GET' && req.headers.get('origin') !== origin)
      return json({ status: 'ERROR', message: 'Cross-origin mutation rejected' }, 403);
    const token = req.cookies.get(sessionCookie)?.value;
    const user = token ? await sessionUser(token) : null;
    // Do not trust client-supplied X-Forwarded-For without a configured trusted proxy.
    if (!(await rateLimit(user ? `api:${user.id}` : 'api:anonymous', user ? 120 : 300, 60)))
      return json({ status: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试。' }, 429);
    if (req.method === 'GET') {
      if (route === 'me') return json({ user, context: await userContext(user?.id) });
      if (route === 'snapshot') return json(await snapshot());
      if (route === 'sources') return json((await snapshot()).sources);
      if (route === 'search') {
        const q = querySchema.parse(req.nextUrl.searchParams.get('q'));
        const data = await snapshot();
        return json(await research(data, q, await userContext(user?.id), user?.id));
      }
      if (route === 'card') {
        const slug = z.string().min(1).max(100).parse(req.nextUrl.searchParams.get('slug'));
        const at = req.nextUrl.searchParams.get('at');
        if (at && !/^\d{4}-\d{2}-\d{2}$/.test(at))
          return json({ status: 'ERROR', message: 'Invalid date' }, 400);
        const data = await snapshot(at ? `${at}T23:59:59.999Z` : undefined);
        const card = frontierCard(data, slug, await userContext(user?.id));
        return card ? json(card) : json({ status: 'UNAVAILABLE' }, 404);
      }
      if (route === 'build') {
        const q = querySchema.parse(req.nextUrl.searchParams.get('q'));
        return json(buildDecision(await snapshot(), q, await userContext(user?.id)));
      }
      if (route === 'usage') {
        if (!user) return json({ status: 'ERROR', message: '请先登录。' }, 401);
        return json(await usageSummary(user.id));
      }
      return json({ status: 'UNAVAILABLE', message: 'Unknown endpoint' }, 404);
    }
    if (req.method !== 'POST') return json({ status: 'ERROR' }, 405);
    if (Number(req.headers.get('content-length')) > 16000)
      return json({ status: 'ERROR', message: 'Request too large' }, 413);
    const raw = await boundedBody(req);
    const body = raw ? JSON.parse(raw) : {};
    if (route === 'auth/register' || route === 'auth/login') {
      const { email, password } = credentialsSchema.parse(body);
      if (
        !(await rateLimit(`auth:${digest(email)}`, 10, 900)) ||
        !(await rateLimit('auth:global', 100, 900))
      )
        return json({ status: 'RATE_LIMITED', message: '登录尝试过多，请 15 分钟后重试。' }, 429);
      let account = (
        await db.query<{ id: string; password_hash: string }>(
          'SELECT id,password_hash FROM users WHERE email=$1',
          [email],
        )
      ).rows[0];
      if (route === 'auth/register') {
        if (process.env.ALLOW_REGISTRATION === 'false')
          return json({ status: 'ERROR', message: 'Registration disabled' }, 403);
        if (account)
          return json({ status: 'ERROR', message: '无法创建账户，请尝试登录或换一个地址。' }, 409);
        const id = randomUUID();
        const hash = await hashPassword(password);
        await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
          id,
          email,
          hash,
        ]);
        account = { id, password_hash: hash };
        await audit(id, 'account.created');
      } else if (!account || !(await verifyPassword(password, account.password_hash)))
        return json({ status: 'ERROR', message: '邮箱或密码不正确。' }, 401);
      if (route === 'auth/login' && !account.password_hash.startsWith('scrypt-v2:'))
        await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [
          account.id,
          await hashPassword(password),
        ]);
      const token = await createSession(account.id);
      await audit(account.id, 'session.created');
      const res = json({ status: 'AVAILABLE', user: { id: account.id, email } });
      res.cookies.set(sessionCookie, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: origin.startsWith('https:'),
        path: '/',
        maxAge: 604800,
      });
      return res;
    }
    if (!user) return json({ status: 'ERROR', message: '请先创建本地账户或登录。' }, 401);
    if (route === 'llm') {
      const input = z
        .object({
          task: z.enum(['classification', 'extraction', 'research', 'build-analysis']),
          query: querySchema,
          cardId: z.string().max(100).optional(),
        })
        .parse(body);
      if (!(await rateLimit(`llm:${user.id}`, 8, 3600)))
        return json({ status: 'RATE_LIMITED' }, 429);
      return json(
        await groundedTask(await snapshot(), input.task, input.query, user.id, input.cardId),
      );
    }
    if (route === 'auth/delete' || route === 'privacy/clear') {
      const { password } = z.object({ password: z.string().min(1).max(128) }).parse(body);
      if (!(await rateLimit(`reauth:${user.id}`, 5, 900)))
        return json({ status: 'RATE_LIMITED' }, 429);
      const account = (
        await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1', [
          user.id,
        ])
      ).rows[0];
      if (!account || !(await verifyPassword(password, account.password_hash)))
        return json({ status: 'ERROR', message: '重新验证失败。' }, 401);
      if (route === 'privacy/clear') {
        await purgePersonalHistory(user.id);
        return json({ status: 'AVAILABLE' });
      }
      await deleteAccount(user.id);
      const res = json({ status: 'AVAILABLE' });
      res.cookies.delete(sessionCookie);
      return res;
    }
    if (route === 'auth/logout') {
      const token = req.cookies.get(sessionCookie)?.value;
      if (token) await db.query('DELETE FROM sessions WHERE token_hash=$1', [digest(token)]);
      const res = json({ status: 'AVAILABLE' });
      res.cookies.delete(sessionCookie);
      return res;
    }
    if (route === 'context') {
      const context = contextSchema.parse(body);
      await db.query(
        'INSERT INTO user_contexts(user_id,context) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET context=excluded.context,updated_at=now()',
        [user.id, JSON.stringify(context)],
      );
      await audit(user.id, 'context.updated');
      return json({ status: 'AVAILABLE', context });
    }
    if (route === 'radar/refresh') {
      if (!(await rateLimit('radar:global', 1, 300)))
        return json(
          { status: 'RATE_LIMITED', message: '全局刷新间隔为 5 分钟，现有证据仍可查看。' },
          429,
        );
      const sourceId = z.object({ sourceId: z.string().max(120).optional() }).parse(body).sourceId;
      await snapshot();
      const result = await refreshSources(sourceId);
      await audit(user.id, 'radar.refreshed', { status: result.status });
      return json(
        result,
        result.status === 'RATE_LIMITED' ? 429 : result.status === 'UNAVAILABLE' ? 404 : 200,
      );
    }
    return json({ status: 'UNAVAILABLE', message: 'Unknown endpoint' }, 404);
  } catch (e) {
    if (e instanceof Error && e.message === 'BODY_TOO_LARGE')
      return json({ status: 'ERROR', message: 'Request too large' }, 413);
    if (e instanceof z.ZodError || e instanceof SyntaxError || e instanceof RangeError)
      return json({ status: 'ERROR', message: '输入无效，请检查字段或日期。' }, 400);
    console.error(
      JSON.stringify({
        level: 'error',
        requestId,
        event: 'api.failure',
        errorType: e instanceof Error ? e.name : 'Unknown',
      }),
    );
    return json({ status: 'ERROR', message: '服务暂时不可用，请重试。', requestId }, 500);
  }
}
export const GET = handle;
export const POST = handle;
