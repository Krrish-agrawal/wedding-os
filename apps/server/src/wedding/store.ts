import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { WeddingStateSchema, applyWeddingAction, createSampleWedding, type ApplyResult, type WeddingState } from '@ave/shared';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const isValidWeddingId = (id: string): boolean => ID_PATTERN.test(id);

/**
 * In-memory wedding workspaces with optional JSON persistence. Every change goes through
 * `applyWeddingAction`; nothing else can modify a state. Saved files are re-validated on load, and a file
 * that fails validation is set aside rather than overwritten.
 */
export class WeddingStore extends EventEmitter<{ change: [WeddingState] }> {
  private readonly weddings = new Map<string, WeddingState>();

  constructor(private readonly dir?: string) {
    super();
    if (dir) fs.mkdirSync(dir, { recursive: true });
  }

  /** The workspace for `id`, created from the sample wedding on first use. Throws on an unsafe id. */
  getOrCreate(id: string): WeddingState {
    if (!isValidWeddingId(id)) throw new Error('Invalid wedding id');
    const hit = this.weddings.get(id);
    if (hit) return hit;
    const loaded = this.load(id) ?? createSampleWedding(id);
    this.weddings.set(id, loaded);
    return loaded;
  }

  dispatch(id: string, action: unknown): ApplyResult {
    const current = this.getOrCreate(id);
    const result = applyWeddingAction(current, action);
    if (result.ok) {
      this.weddings.set(id, result.state);
      this.save(result.state);
      this.emit('change', result.state);
    }
    return result;
  }

  private file(id: string): string | null {
    return this.dir ? path.join(this.dir, `${id}.json`) : null;
  }

  private load(id: string): WeddingState | null {
    const file = this.file(id);
    if (!file || !fs.existsSync(file)) return null;
    try {
      const parsed = WeddingStateSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (parsed.success && parsed.data.id === id) return parsed.data;
    } catch {
      // fall through to quarantine
    }
    try {
      fs.renameSync(file, `${file}.unreadable-${Date.now()}`);
    } catch {
      // nothing more to do; start fresh
    }
    return null;
  }

  private save(state: WeddingState): void {
    const file = this.file(state.id);
    if (!file) return;
    try {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file);
    } catch {
      // Persistence is best-effort; the in-memory state stays authoritative.
    }
  }
}
