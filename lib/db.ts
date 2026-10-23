import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFile, readdir, mkdir, open, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseLifecycle, UnsafeDatabaseCleanup } from './db-lifecycle';
export interface DB {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
async function connect(): Promise<DB> {
  let db: DB | undefined;
  let release: (() => Promise<void>) | undefined;
  let p: PGlite | undefined;
  let pool: pg.Pool | undefined;
  try {
    if (process.env.DATABASE_URL) {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
      const owner = pool;
      const wrap = (client: pg.Pool | pg.PoolClient): DB => ({
        query: async (sql, params) => ({ rows: (await client.query(sql, params)).rows }),
        exec: (sql) => client.query(sql),
        close: async () => {},
        transaction: async (fn) => {
          if (client !== owner) throw new Error('Nested transaction unsupported');
          const c = await owner.connect();
          try {
            await c.query('BEGIN');
            const value = await fn(wrap(c));
            await c.query('COMMIT');
            return value;
          } catch (error) {
            try {
              await c.query('ROLLBACK');
            } catch (rollback) {
              throw new AggregateError([error, rollback], 'Transaction and rollback failed', {
                cause: error,
              });
            }
            throw error;
          } finally {
            c.release();
          }
        },
      });
      db = wrap(owner);
      db.close = () => owner.end();
    } else {
      if (process.env.REQUIRE_STANDARD_POSTGRES === 'true')
        throw new Error('Standard PostgreSQL is required');
      const dir = path.resolve(/*turbopackIgnore: true*/
        process.env.PGLITE_DIR || path.join(process.cwd(), '.data', 'postgres'),
      );
      await mkdir(dir, { recursive: true });
      const lockPath = path.join(dir, '.frontier.lock');
      const token = JSON.stringify({ pid: process.pid, token: randomUUID() });
      let lock;
      try {
        lock = await open(lockPath, 'wx', 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        throw new Error(
          'PGlite is already open or has an unverified stale lock. Stop the app and inspect the lock; never remove an active lock.',
        );
      }
      release = async () => {
        // Do not delete a lock now belonging to another instance.
        if ((await readFile(lockPath, 'utf8')) !== token)
          throw new Error('Database lock ownership changed');
        await unlink(lockPath);
      };
      try {
        await lock.writeFile(token);
      } finally {
        await lock.close();
      }
      p = new PGlite(dir);
      const instance = p;
      await instance.waitReady;
      db = {
        query: async <T>(sql: string, params?: unknown[]) => ({
          rows: (await instance.query<T>(sql, params)).rows,
        }),
        exec: (sql) => instance.exec(sql),
        transaction: (fn) =>
          instance.transaction((tx) =>
            fn({
              query: async <T>(sql: string, params?: unknown[]) => ({
                rows: (await tx.query<T>(sql, params)).rows,
              }),
              exec: (sql) => tx.exec(sql),
              transaction: async () => {
                throw new Error('Nested transaction unsupported');
              },
              close: async () => {
                throw new Error('Cannot close a transaction');
              },
            }),
          ),
        close: async () => {
          await instance.close();
          await release!();
        },
      };
    }
    await db.transaction(async (tx) => {
      if (pool) await tx.query('SELECT pg_advisory_xact_lock(1179206977)');
      await tx.exec(
        'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      for (const name of (await readdir(path.join(process.cwd(), 'db', 'migrations')))
        .filter((x) => x.endsWith('.sql'))
        .sort()) {
        if (
          !(await tx.query('SELECT name FROM schema_migrations WHERE name=$1', [name])).rows.length
        ) {
          await tx.exec(await readFile(path.join(process.cwd(), 'db', 'migrations', name), 'utf8'));
          await tx.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
        }
      }
    });
    return db;
  } catch (original) {
    try {
      if (db) await db.close();
      else {
        // PGlite.close may itself reject after failed initialization. In that case
        // retain the lock and a sticky fault, because resource release is uncertain.
        if (p && !p.closed) await p.close();
        if (pool) await pool.end();
        if (release) await release();
      }
    } catch (cleanup) {
      throw new UnsafeDatabaseCleanup(original, cleanup);
    }
    throw original;
  }
}
const g = globalThis as unknown as { frontierLifecycle?: DatabaseLifecycle };
const lifecycle = (g.frontierLifecycle ??= new DatabaseLifecycle(connect));
export const database = () => lifecycle.open();
export const closeDatabase = () => lifecycle.close();
