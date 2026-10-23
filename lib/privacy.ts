import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { database, type DB } from './db';
export const erasureDigest = (id: string) => createHash('sha256').update(id).digest('hex');
const ledgerPath = () =>
  path.resolve(
    /* turbopackIgnore: true */ process.env.ERASURE_LEDGER_PATH || '.data/erasure-ledger.jsonl',
  );
export async function ensureErasureLedger() {
  await mkdir(path.dirname(ledgerPath()), { recursive: true });
  const file = await open(/* turbopackIgnore: true */ ledgerPath(), 'a', 0o600);
  await file.sync();
  await file.close();
}
export async function eraseRows(tx: DB, userId: string) {
  await tx.query('DELETE FROM audit_log WHERE user_id=$1', [userId]);
  await tx.query('DELETE FROM llm_budgets WHERE bucket LIKE $1', [`user:${userId}:%`]);
  await tx.query('DELETE FROM rate_limits WHERE bucket=$1', [`api:${userId}`]);
  await tx.query('DELETE FROM users WHERE id=$1', [userId]);
}
export async function deleteAccount(userId: string) {
  const db = await database();
  const digest = erasureDigest(userId);
  await ensureErasureLedger();
  // Fsync journal BEFORE SQL deletion: an old backup must never resurrect a successfully erased account.
  const file = await open(/* turbopackIgnore: true */ ledgerPath(), 'a', 0o600);
  try {
    await file.writeFile(
      JSON.stringify({ user_digest: digest, erased_at: new Date().toISOString() }) + '\n',
    );
    await file.sync();
  } finally {
    await file.close();
  }
  await db.transaction(async (tx) => {
    await tx.query(
      'INSERT INTO erasure_tombstones(user_digest) VALUES($1) ON CONFLICT DO NOTHING',
      [digest],
    );
    await eraseRows(tx, userId);
  });
}
export async function applyErasureLedger(tx: DB) {
  // Missing or corrupt journal fails closed. Operators must supply the latest journal, independently of backups.
  const lines = (await readFile(/* turbopackIgnore: true */ ledgerPath(), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const digests = new Set<string>(
    (
      await tx.query<{ user_digest: string }>('SELECT user_digest FROM erasure_tombstones')
    ).rows.map((r) => r.user_digest),
  );
  for (const l of lines) {
    if (!/^[a-f0-9]{64}$/.test(l.user_digest)) throw new Error('Invalid erasure ledger');
    if (l.action !== 'clear') digests.add(l.user_digest);
  }
  for (const digest of digests)
    await tx.query(
      'INSERT INTO erasure_tombstones(user_digest) VALUES($1) ON CONFLICT DO NOTHING',
      [digest],
    );
  for (const user of (await tx.query<{ id: string }>('SELECT id FROM users')).rows)
    if (digests.has(erasureDigest(user.id))) await eraseRows(tx, user.id);
  for (const l of lines.filter((l) => l.action === 'clear')) {
    if (!Number.isFinite(Date.parse(l.erased_at))) throw new Error('Invalid erasure time');
    for (const user of (await tx.query<{ id: string }>('SELECT id FROM users')).rows)
      if (erasureDigest(user.id) === l.user_digest) {
        await tx.query('DELETE FROM research_runs WHERE user_id=$1 AND created_at<=$2', [
          user.id,
          l.erased_at,
        ]);
        await tx.query('DELETE FROM user_contexts WHERE user_id=$1 AND updated_at<=$2', [
          user.id,
          l.erased_at,
        ]);
        await tx.query('DELETE FROM llm_cache WHERE user_id=$1', [user.id]);
      }
  }
}
export async function purgePersonalHistory(userId: string) {
  const db = await database();
  await ensureErasureLedger();
  const file = await open(/* turbopackIgnore: true */ ledgerPath(), 'a', 0o600);
  try {
    await file.writeFile(
      JSON.stringify({
        action: 'clear',
        user_digest: erasureDigest(userId),
        erased_at: new Date().toISOString(),
      }) + '\n',
    );
    await file.sync();
  } finally {
    await file.close();
  }
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM research_runs WHERE user_id=$1', [userId]);
    await tx.query('DELETE FROM llm_cache WHERE user_id=$1', [userId]);
    await tx.query('DELETE FROM user_contexts WHERE user_id=$1', [userId]);
  });
}
export async function retentionSweep() {
  const db = await database();
  await db.transaction(async (tx) => {
    await tx.query("DELETE FROM research_runs WHERE created_at<now()-interval '30 days'");
    await tx.query('DELETE FROM llm_cache WHERE expires_at<now()');
    await tx.query('DELETE FROM card_cache WHERE expires_at<now()');
    await tx.query('DELETE FROM sessions WHERE expires_at<now()');
    await tx.query('DELETE FROM rate_limits WHERE reset_at<now()');
    await tx.query("DELETE FROM audit_log WHERE created_at<now()-interval '30 days'");
    await tx.query(
      "DELETE FROM llm_usage WHERE created_at<now()-interval '90 days' AND status<>'RUNNING'",
    );
  });
}
