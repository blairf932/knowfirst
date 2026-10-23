import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { promisify } from 'node:util';
import { database } from './db';
import { cookies } from 'next/headers';
const scrypt = promisify(scryptCallback);
const strongScrypt = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(
      password,
      salt,
      64,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (e, key) => (e ? reject(e) : resolve(key)),
    ),
  );
export const sessionCookie = 'frontier_session';
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await strongScrypt(password, salt);
  return `scrypt-v2:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const strong = stored.startsWith('scrypt-v2:');
  const [salt, hex] = (strong ? stored.slice(10) : stored).split(':');
  if (!salt || !hex) return false;
  const actual = strong
    ? await strongScrypt(password, salt)
    : ((await scrypt(password, salt, 64)) as Buffer);
  const expected = Buffer.from(hex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function currentUser() {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return null;
  return sessionUser(token);
}
export async function sessionUser(token: string) {
  const db = await database();
  return (
    (
      await db.query<{ id: string; email: string }>(
        'SELECT u.id,u.email FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()',
        [digest(token)],
      )
    ).rows[0] ?? null
  );
}
export async function createSession(userId: string) {
  const db = await database();
  const token = randomBytes(32).toString('base64url');
  await db.query('DELETE FROM sessions WHERE expires_at<now()');
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [digest(token), userId],
  );
  return token;
}
export async function rateLimit(bucket: string, limit: number, seconds: number) {
  const db = await database();
  const r = await db.query<{ count: number }>(
    "INSERT INTO rate_limits(bucket,count,reset_at) VALUES($1,1,now()+($2::text||' seconds')::interval) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<=now() THEN 1 ELSE rate_limits.count+1 END, reset_at=CASE WHEN rate_limits.reset_at<=now() THEN excluded.reset_at ELSE rate_limits.reset_at END RETURNING count",
    [bucket, seconds],
  );
  return r.rows[0].count <= limit;
}
export async function audit(
  userId: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  const db = await database();
  await db.query('INSERT INTO audit_log(id,user_id,action,metadata) VALUES($1,$2,$3,$4)', [
    randomUUID(),
    userId,
    action,
    JSON.stringify(metadata),
  ]);
}
