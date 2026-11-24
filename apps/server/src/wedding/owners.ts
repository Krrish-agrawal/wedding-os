import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Demo-session ownership. A workspace id alone is not enough once a workspace has been CLAIMED: the browser that
 * creates a workspace claims it and receives a secret token (shown once, only a SHA-256 hash is stored). Every
 * request for a claimed workspace must carry the token, including confirming or cancelling proposals.
 *
 * This is deliberately small. It keeps workspace ids from being enough to read or change someone's wedding, but it is
 * not an account system: there is no login, the token lives in the browser, and an unclaimed workspace (never opened by
 * the web app) is open. The path to real authentication is to replace `verify` with a session/user check; every route
 * already goes through the one hook in routes.ts.
 */
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export class OwnerStore {
  private readonly owners = new Map<string, string>();
  constructor(private readonly file?: string) {
    if (file) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
        for (const [id, h] of Object.entries(raw)) if (/^[0-9a-f]{64}$/.test(h)) this.owners.set(id, h);
      } catch { /* none yet */ }
    }
  }

  isClaimed(id: string): boolean { return this.owners.has(id); }

  /** Claims an unclaimed workspace and returns its token, or null if already claimed. */
  claim(id: string): string | null {
    if (this.owners.has(id)) return null;
    const token = `wt_${randomBytes(24).toString('base64url')}`;
    this.owners.set(id, hash(token));
    this.save();
    return token;
  }

  /** True when the workspace is unclaimed (open) or `token` is its token. */
  verify(id: string, token: string | undefined): boolean {
    const h = this.owners.get(id);
    if (!h) return true;
    if (!token) return false;
    const a = Buffer.from(hash(token), 'hex');
    const b = Buffer.from(h, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private save(): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.owners)), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch { /* best effort */ }
  }
}
