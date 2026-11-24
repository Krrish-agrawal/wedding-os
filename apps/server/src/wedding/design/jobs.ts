import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  STUDIO_ROOMS, demoBriefFromForm, planScene, sampleVenue, studioRoom, studioVenueId,
  type ApplyResult, type DesignForm, type ScenePlan, type WeddingDesignBrief, type WeddingState,
} from '@ave/shared';
import type { ChatCreate } from '../../agent/sim.js';
import { DEFAULT_IMAGE_LIMITS, type ImageService } from '../storage/types.js';
import type { WeddingStore } from '../store.js';
import { DesignError, analyseInspiration, mapProviderError, type DesignErrorCode, type VisionUsage } from './vision.js';

/**
 * Design generation jobs and the shared "plan and apply" step.
 *
 * Lifecycle: pending -> analysing -> planning -> rendering -> completed | failed | cancelled. The wedding's scene is touched
 * only by the single final `apply_design_plan` dispatch (all-or-nothing, validated by the reducer); every failure or
 * cancellation before it leaves the last valid scene exactly as it was. The form's venue, guest count and decoration limit
 * are applied just before that dispatch and rolled back if it is refused.
 *
 * Honesty: `source === 'vision'` only when a real vision model analysed real photographs. Otherwise the job is the labelled
 * sample ("demo") workflow, and `analysed` is false.
 */

export type JobStatus = 'pending' | 'analysing' | 'planning' | 'rendering' | 'completed' | 'failed' | 'cancelled';
const ACTIVE: readonly JobStatus[] = ['pending', 'analysing', 'planning', 'rendering'];

export interface DesignJob {
  id: string;
  weddingId: string;
  status: JobStatus;
  progress: number;
  source: 'vision' | 'demo';
  /** True only when a real vision model looked at the customer's photographs. */
  analysed: boolean;
  /** Plain-language note about what did and did not happen (e.g. photos kept but not analysed). */
  notice: string | null;
  error: { code: DesignErrorCode; message: string } | null;
  versionId: string | null;
  startedAt: number;
  finishedAt: number | null;
  latencyMs: number | null;
  usage: { model: string; promptTokens: number; completionTokens: number } | null;
}

export interface GenerateInput { form: DesignForm; venueId?: string; imageIds: string[] }
export type StartResult = { ok: true; job: DesignJob } | { ok: false; status: 400 | 404 | 409 | 503; code: string; message: string };
export type ReplanResult =
  | { ok: true; state: WeddingState; plan: ScenePlan; versionId: string; variant: number }
  | { ok: false; error: string; hint: string; code: 'no_design' | 'plan_failed' | 'rejected' | 'over_limit' };

export interface DesignServiceDeps {
  store: WeddingStore;
  images: ImageService | null;
  /** The chat provider; null = no key. */
  create: ChatCreate | null;
  visionModel?: string;
  timeoutMs?: number;
  /** Directory for the (non-sensitive) job log. */
  dir?: string;
  now?: () => number;
  log?: { info: (o: object, msg: string) => void };
}

const MAX_JOBS = 50;
const rid = () => randomBytes(9).toString('base64url');

export class DesignService {
  private readonly jobs = new Map<string, DesignJob>();
  private readonly active = new Map<string, string>();
  private readonly aborts = new Map<string, AbortController>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly now: () => number;

  constructor(private readonly d: DesignServiceDeps) {
    this.now = d.now ?? Date.now;
    this.load();
  }

  /** Real analysis is available only with a provider AND an explicitly configured vision model. */
  get visionConfigured(): boolean { return this.d.create !== null && Boolean(this.d.visionModel); }
  get visionModel(): string | null { return this.d.visionModel ?? null; }
  get imagesAvailable(): boolean { return this.d.images !== null; }

  status() {
    const limits = (this.d.images as { imageLimits?: typeof DEFAULT_IMAGE_LIMITS } | null)?.imageLimits ?? DEFAULT_IMAGE_LIMITS;
    return {
      visionConfigured: this.visionConfigured,
      visionModel: this.visionConfigured ? this.visionModel : null,
      storage: this.d.images ? ((this.d.images as { blobKind?: string }).blobKind ?? 'local') : 'unavailable',
      limits: { maxFiles: limits.maxFiles, maxBytesPerFile: limits.maxBytesPerFile, retentionHours: limits.retentionHours },
    };
  }

  get(weddingId: string, jobId: string): DesignJob | null {
    const j = this.jobs.get(jobId);
    return j && j.weddingId === weddingId ? { ...j } : null;
  }
  /** Resolves when the job has finished (tests and the smoke script). */
  settled(jobId: string): Promise<void> { return this.running.get(jobId) ?? Promise.resolve(); }

  // ---- starting jobs ---------------------------------------------------------------------------------------------

  startGenerate(weddingId: string, input: GenerateInput): StartResult {
    if (this.active.has(weddingId)) return { ok: false, status: 409, code: 'job_active', message: 'A design is already being generated for this wedding. Wait for it or cancel it.' };
    if (input.imageIds.length > 0 && !this.d.images) return { ok: false, status: 503, code: 'storage_unavailable', message: 'Image storage is not ready on this server.' };
    if (input.venueId && !STUDIO_ROOMS[input.venueId]) return { ok: false, status: 400, code: 'bad_venue', message: 'That venue has no 3D room.' };
    const real = this.visionConfigured && input.imageIds.length > 0;
    const job = this.newJob(weddingId, real ? 'vision' : 'demo');
    if (!real) job.notice = input.imageIds.length > 0
      ? 'Your photographs were kept but NOT analysed: image analysis is not configured on this server. This is a sample design built from your written choices. You can delete the photographs.'
      : 'Sample design built from your written choices only. No photographs were added or analysed.';
    this.launch(job, (signal) => this.runGenerate(job, input, signal));
    return { ok: true, job: { ...job } };
  }

  startAnother(weddingId: string): StartResult {
    if (this.active.has(weddingId)) return { ok: false, status: 409, code: 'job_active', message: 'A design is already being generated for this wedding.' };
    const s = this.d.store.getOrCreate(weddingId);
    if (!s.design.brief) return { ok: false, status: 409, code: 'no_design', message: 'There is no design yet. Create one first.' };
    const job = this.newJob(weddingId, s.design.source ?? 'demo');
    job.analysed = false;
    job.notice = 'Another arrangement of the same design brief. No new image analysis was done.';
    this.launch(job, async () => {
      this.step(job, 'planning', 0.5);
      const r = this.anotherNow(weddingId);
      if (!r.ok) throw new DesignError('plan_failed', `${r.error} ${r.hint}`);
      job.versionId = r.versionId;
    });
    return { ok: true, job: { ...job } };
  }

  cancel(weddingId: string, jobId: string): DesignJob | null {
    const j = this.jobs.get(jobId);
    if (!j || j.weddingId !== weddingId) return null;
    if (ACTIVE.includes(j.status)) {
      this.aborts.get(jobId)?.abort();
      this.finish(j, 'cancelled', new DesignError('cancelled', 'The design was cancelled. Your previous design is unchanged.'));
    }
    return { ...j };
  }

  // ---- the shared plan-and-apply step (jobs and chat tools) -------------------------------------------------------

  nextLabel(s: WeddingState): string {
    const n = Math.max(0, ...s.design.versions.map((v) => Number(/^Version (\d+)$/.exec(v.label)?.[1] ?? 0)));
    return `Version ${n + 1}`;
  }

  /** Re-plans the stored brief (optionally edited) for the current venue and applies it as a NEW version. Sync and all-or-nothing. */
  replan(weddingId: string, o: { brief?: WeddingDesignBrief; variant: number; budgetInr?: number | null }): ReplanResult {
    const s = this.d.store.getOrCreate(weddingId);
    const brief = o.brief ?? s.design.brief;
    if (!brief) return { ok: false, code: 'no_design', error: 'There is no design to change yet.', hint: 'Create a design on the Studio page first.' };
    const base: DesignForm = s.design.form ?? { description: '', style: brief.style.slice(0, 60), guestCount: s.profile.guestCount, decorationBudgetInr: null, palette: [] };
    const budget = o.budgetInr !== undefined ? o.budgetInr : (s.budget.limits.decoration ?? base.decorationBudgetInr);
    const form: DesignForm = { ...base, guestCount: s.profile.guestCount, decorationBudgetInr: budget };
    const plan = planScene({ brief, room: studioRoom(s), guests: s.profile.guestCount, budgetInr: budget, variant: o.variant });
    if (!plan.ok) return { ok: false, code: 'plan_failed', error: plan.error, hint: plan.hint };
    const versionId = `dv-${rid()}`;
    const r = this.d.store.dispatch(weddingId, this.applyAction(s, versionId, brief, form, plan.plan, s.design.source ?? 'demo', o.variant));
    if (!r.ok) return { ok: false, code: r.code === 'over_limit' ? 'over_limit' : 'rejected', error: r.error, hint: r.hint };
    return { ok: true, state: r.state, plan: plan.plan, versionId, variant: o.variant };
  }

  anotherNow(weddingId: string): ReplanResult {
    const s = this.d.store.getOrCreate(weddingId);
    return this.replan(weddingId, { variant: s.design.variantCounter + 1 });
  }

  private applyAction(s: WeddingState, versionId: string, brief: WeddingDesignBrief, form: DesignForm, plan: ScenePlan, source: 'vision' | 'demo', variant: number) {
    return {
      type: 'apply_design_plan' as const, versionId, label: this.nextLabel(s), createdAt: new Date(this.now()).toISOString(), source,
      venueId: studioVenueId(s), brief, form, objects: plan.objects, summary: plan.description.slice(0, 800), substitutions: plan.substitutions.map((x) => x.slice(0, 200)).slice(0, 20), variant,
    };
  }

  // ---- internals -------------------------------------------------------------------------------------------------

  private newJob(weddingId: string, source: 'vision' | 'demo'): DesignJob {
    const job: DesignJob = { id: `job-${rid()}`, weddingId, status: 'pending', progress: 0, source, analysed: false, notice: null, error: null, versionId: null, startedAt: this.now(), finishedAt: null, latencyMs: null, usage: null };
    this.jobs.set(job.id, job);
    this.active.set(weddingId, job.id);
    this.aborts.set(job.id, new AbortController());
    while (this.jobs.size > MAX_JOBS) { const oldest = [...this.jobs.values()].find((j) => !ACTIVE.includes(j.status)); if (!oldest) break; this.jobs.delete(oldest.id); }
    return job;
  }

  private launch(job: DesignJob, run: (signal: AbortSignal) => Promise<void>): void {
    const signal = this.aborts.get(job.id)!.signal;
    const p = (async () => {
      await Promise.resolve();
      try {
        await run(signal);
        if (job.status !== 'cancelled') this.finish(job, 'completed');
      } catch (err) {
        if (job.status === 'cancelled') return;
        this.finish(job, err instanceof DesignError && err.code === 'cancelled' ? 'cancelled' : 'failed', err instanceof DesignError ? err : mapProviderError(err, signal));
      }
    })().finally(() => { this.running.delete(job.id); });
    this.running.set(job.id, p);
  }

  private step(job: DesignJob, status: JobStatus, progress: number): void {
    if (job.status === 'cancelled') throw new DesignError('cancelled', 'The design was cancelled.');
    job.status = status;
    job.progress = progress;
    this.persist();
  }

  private finish(job: DesignJob, status: 'completed' | 'failed' | 'cancelled', err?: DesignError): void {
    job.status = status;
    job.progress = status === 'completed' ? 1 : job.progress;
    job.finishedAt = this.now();
    job.latencyMs = job.finishedAt - job.startedAt;
    if (err && status !== 'completed') job.error = { code: err.code, message: err.message };
    if (this.active.get(job.weddingId) === job.id) this.active.delete(job.weddingId);
    this.aborts.delete(job.id);
    this.persist();
    // Non-sensitive metadata only: ids, status, timings, token counts. Never keys, prompts or image data.
    this.d.log?.info({ jobId: job.id, status, source: job.source, latencyMs: job.latencyMs, code: job.error?.code ?? null, usage: job.usage }, 'design job finished');
  }

  private async runGenerate(job: DesignJob, input: GenerateInput, signal: AbortSignal): Promise<void> {
    const w = job.weddingId;
    const form = input.form;
    const venueId = input.venueId ?? studioVenueId(this.d.store.getOrCreate(w));
    const room = STUDIO_ROOMS[venueId];
    const venue = sampleVenue(venueId);
    if (!room || !venue) throw new DesignError('venue_conflict', 'That venue is not available.');
    if (venue.capacity < form.guestCount) throw new DesignError('venue_conflict', `${room.name} holds ${venue.capacity} guests but you entered ${form.guestCount}. Choose a larger venue or fewer guests.`);

    let brief: WeddingDesignBrief;
    if (job.source === 'vision') {
      this.step(job, 'analysing', 0.1);
      const images: string[] = [];
      for (const id of input.imageIds) {
        const img = await this.d.images!.readForModel(w, id).catch(() => null);
        if (!img) throw new DesignError('images_missing', 'One of the photographs is no longer available. Upload it again.');
        images.push(img.dataUrl);
      }
      const r = await analyseInspiration({ create: this.d.create!, model: this.d.visionModel!, images, form, venueName: room.name, signal, timeoutMs: this.d.timeoutMs });
      job.usage = { model: r.usage.model, promptTokens: r.usage.promptTokens, completionTokens: r.usage.completionTokens };
      job.analysed = true;
      brief = r.brief;
    } else brief = demoBriefFromForm(form);

    this.step(job, 'planning', 0.6);
    const planned = planScene({ brief, room, guests: form.guestCount, budgetInr: form.decorationBudgetInr, variant: 0 });
    if (!planned.ok) throw new DesignError('plan_failed', `${planned.error} ${planned.hint}`);
    this.step(job, 'rendering', 0.85);
    job.versionId = this.commit(w, { brief, form, plan: planned.plan, venueId, input, source: job.source });
  }

  /** Applies the form's venue/guests/limit and then the plan; rolls the prerequisites back if the plan is refused. */
  private commit(w: string, c: { brief: WeddingDesignBrief; form: DesignForm; plan: ScenePlan; venueId: string; input: GenerateInput; source: 'vision' | 'demo' }): string {
    const { store } = this.d;
    const before = store.getOrCreate(w);
    const undo: (() => void)[] = [];
    const run = (a: Parameters<WeddingStore['dispatch']>[1]): ApplyResult => store.dispatch(w, a);
    const rollback = () => { for (const u of undo.reverse()) { try { u(); } catch { /* best effort */ } } };
    const fail = (code: DesignErrorCode, msg: string): never => { rollback(); throw new DesignError(code, msg); };

    if (c.form.guestCount !== before.profile.guestCount) {
      const r = run({ type: 'update_profile', patch: { guestCount: c.form.guestCount } });
      if (!r.ok) return fail('plan_failed', `${r.error} ${r.hint}`);
      undo.push(() => run({ type: 'update_profile', patch: { guestCount: before.profile.guestCount } }));
    }
    if (c.input.venueId && c.input.venueId !== before.venueId) {
      let r = run({ type: 'select_venue', venueId: c.input.venueId });
      if (!r.ok) {
        // The current decorations do not fit the new room. Keep them as a version, clear the scene, switch; restore on failure.
        const cur = store.getOrCreate(w);
        if (cur.scene.objects.length > 0) {
          const snapId = `dv-${rid()}`;
          const snap = run({ type: 'snapshot_design_version', id: snapId, label: `Before ${c.input.venueId === before.venueId ? 'change' : 'venue change'}`.slice(0, 60), createdAt: new Date(this.now()).toISOString() });
          if (!snap.ok) return fail('venue_conflict', `${snap.error} ${snap.hint}`);
          undo.push(() => { run({ type: 'restore_design_version', id: snapId }); run({ type: 'delete_design_version', id: snapId }); });
          run({ type: 'clear_scene' });
        }
        r = run({ type: 'select_venue', venueId: c.input.venueId });
        if (!r.ok) return fail('venue_conflict', `${r.error} ${r.hint}`);
      } else undo.push(() => run({ type: 'select_venue', venueId: before.venueId }));
    }
    const lim = before.budget.limits.decoration;
    if (c.form.decorationBudgetInr !== (lim ?? null)) {
      const r = run({ type: 'set_budget_limit', category: 'decoration', amount: c.form.decorationBudgetInr });
      if (!r.ok) return fail('plan_failed', `${r.error} ${r.hint}`);
      undo.push(() => run({ type: 'set_budget_limit', category: 'decoration', amount: lim ?? null }));
    }
    const now = store.getOrCreate(w);
    const versionId = `dv-${rid()}`;
    const r = run(this.applyAction(now, versionId, c.brief, c.form, c.plan, c.source, 0));
    if (!r.ok) return fail('plan_failed', `${r.error} ${r.hint}`);
    run({ type: 'set_reference_images', ids: c.input.imageIds });
    return versionId;
  }

  // ---- persistence of the (non-sensitive) job log ------------------------------------------------------------------

  private file(): string | null { return this.d.dir ? path.join(this.d.dir, 'jobs.json') : null; }

  private load(): void {
    const f = this.file();
    if (!f) return;
    try {
      const saved = JSON.parse(fs.readFileSync(f, 'utf8')) as DesignJob[];
      for (const j of saved) {
        if (ACTIVE.includes(j.status)) { j.status = 'failed'; j.error = { code: 'server_restarted', message: 'The server restarted while this design was being made. Your previous design is unchanged. Please try again.' }; j.finishedAt = this.now(); }
        this.jobs.set(j.id, j);
      }
    } catch { /* none yet */ }
  }

  private persist(): void {
    const f = this.file();
    if (!f) return;
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(`${f}.tmp`, JSON.stringify([...this.jobs.values()]), { mode: 0o600 });
      fs.renameSync(`${f}.tmp`, f);
    } catch { /* best effort */ }
  }
}

export type { VisionUsage };
