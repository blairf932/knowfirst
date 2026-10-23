import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('release input gate rejects nested env variants and credentials before copying', async () => {
  // mjs is also directly imported by the production packaging script.
  const { assertSafeTree } = await import('../scripts/release-safety.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'afi-release-safety-'));
  try {
    await mkdir(path.join(root, 'nested'));
    const file = path.join(root, 'nested', 'readme.txt');
    await writeFile(file, 'public documentation');
    assert.equal(await assertSafeTree(root), 1);
    for (const name of ['knowfirst-AUDIT.env', 'knowfirst-AUDIT.env.local', '.env', '.env.production', 'OPEN.ENV']) {
      const envFile = path.join(root, 'nested', name);
      await writeFile(envFile, 'AFI_NON_SECRET_SENTINEL');
      await assert.rejects(assertSafeTree(root), /private path/);
      await rm(envFile);
    }
    await writeFile(file, 'AFI_CONTENT_SENTINEL_123456789');
    await assert.rejects(assertSafeTree(root, ['AFI_CONTENT_SENTINEL_123456789']), /Configured secret/);
    await writeFile(file, 'sk-' + 'A'.repeat(32));
    await assert.rejects(assertSafeTree(root), /Credential pattern/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
