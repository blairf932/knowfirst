import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const forbiddenName = (name) =>
  /^(?:\.env.*|.+\.env(?:\..*)?|\.data|\.cache|backups|\.git)$/i.test(name);

// Report only a category, never matched credential text or file contents.
export async function assertSafeTree(root, secrets = []) {
  let files = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (forbiddenName(entry.name)) throw new Error('Secret or private path in release input');
    if (entry.isSymbolicLink()) throw new Error('Unresolved symlink in release input');
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files += await assertSafeTree(file, secrets);
    else {
      const content = await readFile(file);
      if (secrets.some((s) => s.length > 8 && content.includes(Buffer.from(s))))
        throw new Error('Configured secret found in release input');
      const text = content.toString('utf8');
      if (/(?:(?<![A-Za-z0-9_])sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[A-Za-z0-9+/=\r\n]{64,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s/:]+:[^\s@]+@)/.test(text))
        throw new Error('Credential pattern found in release input');
      files++;
    }
  }
  return files;
}
