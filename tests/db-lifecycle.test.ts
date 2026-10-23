import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseLifecycle, UnsafeDatabaseCleanup } from '../lib/db-lifecycle';
import type { DB } from '../lib/db';
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
function fake(close: () => Promise<void>, query = async () => ({ rows: [] })): DB {
  return {
    close,
    query: query as DB['query'],
    exec: async () => {},
    transaction: async (fn) => fn(fake(close, query)),
  };
}
test('close waits for operations, shares close, rejects stale handle and serializes reopen', async () => {
  const gate = deferred();
  let opens = 0,
    closes = 0;
  const lifecycle = new DatabaseLifecycle(async () => {
    opens++;
    return fake(
      async () => {
        closes++;
      },
      async () => {
        await gate.promise;
        return { rows: [] };
      },
    );
  });
  const db = await lifecycle.open();
  assert.equal(await lifecycle.open(), db);
  const query = db.query('select 1');
  const a = lifecycle.close(),
    b = lifecycle.close();
  assert.equal(a, b);
  await assert.rejects(db.query('select 2'), /closing/);
  const reopening = lifecycle.open();
  await Promise.resolve();
  assert.equal(closes, 0);
  assert.equal(opens, 1);
  gate.resolve();
  await query;
  await a;
  const next = await reopening;
  assert.notEqual(next, db);
  assert.equal(opens, 2);
  assert.equal(closes, 1);
  await db.close();
  assert.equal(await lifecycle.open(), next);
  await lifecycle.close();
  assert.equal(closes, 2);
});
test('close failure is sticky and never returns a closed connection', async () => {
  let opens = 0;
  const failure = new Error('close failed');
  const lifecycle = new DatabaseLifecycle(async () => {
    opens++;
    return fake(async () => {
      throw failure;
    });
  });
  const db = await lifecycle.open();
  await assert.rejects(db.close(), failure);
  await assert.rejects(db.close(), failure);
  await assert.rejects(lifecycle.open(), failure);
  await assert.rejects(lifecycle.close(), failure);
  assert.equal(opens, 1);
  await assert.rejects(db.query('select 1'), /closing/);
});
test('opening failure preserves error and retries only after safe cleanup', async () => {
  let n = 0;
  const failure = new Error('migration failed');
  const lifecycle = new DatabaseLifecycle(async () => {
    if (!n++) throw failure;
    return fake(async () => {});
  });
  await assert.rejects(lifecycle.open(), failure);
  await lifecycle.open();
  await lifecycle.close();
  const unsafe = new UnsafeDatabaseCleanup(failure, new Error('cleanup failed'));
  const blocked = new DatabaseLifecycle(async () => {
    throw unsafe;
  });
  await assert.rejects(blocked.open(), unsafe);
  await assert.rejects(blocked.open(), unsafe);
  assert.equal(unsafe.cause, failure);
});
test('close during pending initialization waits and prevents overlapping opens', async () => {
  const gate = deferred();
  let opens = 0,
    closes = 0;
  const lifecycle = new DatabaseLifecycle(async () => {
    opens++;
    await gate.promise;
    return fake(async () => {
      closes++;
    });
  });
  const first = lifecycle.open();
  const closing = lifecycle.close();
  const next = lifecycle.open();
  gate.resolve();
  await first;
  await closing;
  await next;
  assert.equal(opens, 2);
  assert.equal(closes, 1);
  await lifecycle.close();
});
