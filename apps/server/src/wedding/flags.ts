import { Flagsmith } from '@flagsmith/nodejs';

/**
 * Feature flags, evaluated SERVER-SIDE through Flagsmith. They gate which specialist tools the orchestrator exposes to the
 * model, are re-checked before every tool runs, and gate the HTTP routes behind them. The browser only receives the resulting
 * booleans to hide navigation; it can never turn a feature on.
 *
 * Failure behaviour (safe fallback): if Flagsmith is unreachable, the last known good values keep being used; with no
 * history, every flag falls back to its documented default (enabled, so a Flagsmith outage cannot take the product down). A
 * flag that has not been created in the Flagsmith project also falls back to its default. The snapshot says which source it
 * came from and whether it is degraded, so the UI never claims live control it does not have.
 */

export const FLAG_NAMES = [
  'agent.decoration', 'agent.budget', 'agent.vendor', 'agent.fashion', 'studio.enabled', 'voice.sarvam', 'tryon.enabled', 'vendor.marketplace.enabled', 'studio.ai_design',
] as const;
export type FlagName = (typeof FLAG_NAMES)[number];

export const FLAG_DESCRIPTIONS: Record<FlagName, string> = {
  'agent.decoration': 'Planner may use the 3D decoration tools',
  'agent.budget': 'Planner may use the budget tools',
  'agent.vendor': 'Planner may search and quote vendors',
  'agent.fashion': 'Planner may use the outfit try-on tools',
  'studio.enabled': '3D Wedding Studio page',
  'voice.sarvam': 'Sarvam voice input',
  'tryon.enabled': 'Virtual Outfit Try-On page',
  'vendor.marketplace.enabled': 'Vendor Marketplace pages and API',
  'studio.ai_design': 'AI design from inspiration photos (generate, refine, versions)',
};

export const DEFAULT_FLAGS: Readonly<Record<FlagName, boolean>> = Object.fromEntries(FLAG_NAMES.map((n) => [n, true])) as Record<FlagName, boolean>;

/** The planner specialist that each flag controls. The venue/details specialist is core and always on. */
export const SPECIALIST_FLAG: Record<string, FlagName | null> = { venue: null, decoration: 'agent.decoration', budget: 'agent.budget', vendor: 'agent.vendor', fashion: 'agent.fashion' };

/** Every flag a specialist needs; all must be on. */
export const SPECIALIST_FLAGS: Record<string, FlagName[]> = { venue: [], decoration: ['agent.decoration'], budget: ['agent.budget'], vendor: ['agent.vendor'], fashion: ['agent.fashion'], design: ['agent.decoration', 'studio.ai_design'] };

export type FlagSource = 'flagsmith-local' | 'flagsmith-remote' | 'defaults';
export interface FlagSnapshot {
  flags: Record<FlagName, boolean>;
  source: FlagSource;
  /** True when Flagsmith was configured but could not be reached, so values are last-known or defaults. */
  degraded: boolean;
  /** Flags whose value came from the built-in default rather than Flagsmith. */
  defaulted: FlagName[];
  fetchedAt: number | null;
  error: string | null;
}

/** Anything that can return the current flag values. The Flagsmith one is below; tests inject their own. */
export interface FlagProvider {
  readonly source: Exclude<FlagSource, 'defaults'>;
  read(): Promise<{ flags: Partial<Record<FlagName, boolean>>; defaulted: FlagName[] }>;
  close?(): void;
}

export function flagsmithProvider(opts: { environmentKey: string; apiUrl?: string }): FlagProvider {
  const local = opts.environmentKey.startsWith('ser.');
  const client = new Flagsmith({
    environmentKey: opts.environmentKey,
    ...(opts.apiUrl ? { apiUrl: opts.apiUrl } : {}),
    enableLocalEvaluation: local,
    environmentRefreshIntervalSeconds: 30,
    requestTimeoutSeconds: 4,
    enableAnalytics: false,
    defaultFlagHandler: () => ({ enabled: true, isDefault: true, value: null }),
  });
  return {
    source: local ? 'flagsmith-local' : 'flagsmith-remote',
    async read() {
      const env = await client.getEnvironmentFlags();
      const flags: Partial<Record<FlagName, boolean>> = {};
      const defaulted: FlagName[] = [];
      for (const n of FLAG_NAMES) {
        const f = env.getFlag(n);
        flags[n] = f.enabled;
        if (f.isDefault) defaulted.push(n);
      }
      return { flags, defaulted };
    },
    close: () => { try { client.close(); } catch { /* ignore */ } },
  };
}

export class FlagService {
  private snap: FlagSnapshot;
  private inflight: Promise<void> | null = null;

  constructor(private readonly provider: FlagProvider | null, private readonly ttlMs = 5_000, private readonly now: () => number = Date.now) {
    this.snap = { flags: { ...DEFAULT_FLAGS }, source: 'defaults', degraded: false, defaulted: [...FLAG_NAMES], fetchedAt: null, error: null };
  }

  get configured(): boolean { return this.provider !== null; }

  /** Synchronous read of the latest known values. Tools use this, so a flag is re-checked on every single call. */
  isEnabled(name: FlagName): boolean { return this.snap.flags[name]; }
  snapshot(): FlagSnapshot { return { ...this.snap, flags: { ...this.snap.flags }, defaulted: [...this.snap.defaulted] }; }

  /** Refreshes from Flagsmith if the cache is older than the TTL (or `force`). Never throws. */
  async refresh(force = false): Promise<FlagSnapshot> {
    if (!this.provider) return this.snapshot();
    const fresh = this.snap.fetchedAt !== null && this.now() - this.snap.fetchedAt < this.ttlMs && !this.snap.degraded;
    if (fresh && !force) return this.snapshot();
    this.inflight ??= (async () => {
      try {
        const r = await this.provider!.read();
        this.snap = { flags: { ...DEFAULT_FLAGS, ...r.flags }, source: this.provider!.source, degraded: false, defaulted: r.defaulted, fetchedAt: this.now(), error: null };
      } catch (err) {
        // Keep last known good values; only the status changes.
        this.snap = { ...this.snap, source: this.snap.fetchedAt === null ? 'defaults' : this.snap.source, degraded: true, fetchedAt: this.snap.fetchedAt ?? this.now() - this.ttlMs, error: 'Flagsmith could not be reached; using the last known values or defaults.' };
        void err;
      }
    })().finally(() => { this.inflight = null; });
    await this.inflight;
    return this.snapshot();
  }

  close(): void { this.provider?.close?.(); }
}

export function createFlagService(env: { FLAGSMITH_ENVIRONMENT_KEY?: string; FLAGSMITH_API_URL?: string }): FlagService {
  return new FlagService(env.FLAGSMITH_ENVIRONMENT_KEY ? flagsmithProvider({ environmentKey: env.FLAGSMITH_ENVIRONMENT_KEY, apiUrl: env.FLAGSMITH_API_URL }) : null);
}
