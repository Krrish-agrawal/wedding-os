import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { OutboundDraftSchema, REPORT_CHANNELS, type Delivery, type OutboundDraft, type OutboundPreview, type ReportChannel } from '@ave/shared';
import { outboundRecipient, sendOutboundDraft } from './deliveries.js';
import { previewReport, sendReport } from './reports.js';
import { deskFor, type DeskRuntime } from './runtime.js';

/**
 * Preview-then-send for everything the admin sends by hand (copilot drafts, quick actions, live-notes
 * next steps). A preview lives in memory only: nothing leaves the app until the admin clicks Send,
 * and an abandoned preview simply expires.
 */

/** How long an unsent preview stays sendable. */
export const OUTBOUND_PREVIEW_TTL_MS = 30 * 60_000;
/** Oldest previews of a session are dropped beyond this, so a runaway copilot cannot pile them up. */
export const MAX_PREVIEWS_PER_SESSION = 20;
const PREVIEW_ID_PREFIX = 'pv';
const PREVIEW_ID_CHARS = 12;
const LABEL_SUBJECT_MAX = 80;

const NOT_FOUND = 'This preview has expired or was already sent. Create it again.';
const ALREADY_SENDING = 'This message is already being sent.';

interface Entry {
  preview: OutboundPreview;
  expiresAt: number;
}

export class PreviewStore {
  private readonly items = new Map<string, Entry>();
  private readonly sending = new Set<string>();

  constructor(
    private readonly now: () => number,
    private readonly ttlMs = OUTBOUND_PREVIEW_TTL_MS,
  ) {}

  private sweep(): void {
    const now = this.now();
    for (const [id, e] of this.items) if (e.expiresAt <= now && !this.sending.has(id)) this.items.delete(id);
  }

  add(preview: OutboundPreview): OutboundPreview {
    this.sweep();
    this.items.set(preview.id, { preview, expiresAt: this.now() + this.ttlMs });
    const mine = this.list(preview.sessionId);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_PREVIEWS_PER_SESSION))) this.items.delete(old.id);
    return preview;
  }

  /** The preview, if it belongs to this session and has not expired. */
  get(sessionId: string, id: string): OutboundPreview | undefined {
    this.sweep();
    const e = this.items.get(id);
    return e && e.preview.sessionId === sessionId ? e.preview : undefined;
  }

  /** Oldest first. */
  list(sessionId: string): OutboundPreview[] {
    return [...this.items.values()].map((e) => e.preview).filter((p) => p.sessionId === sessionId).sort((a, b) => a.createdAt - b.createdAt);
  }

  replace(preview: OutboundPreview): void {
    const e = this.items.get(preview.id);
    if (e) e.preview = preview;
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  /** Marks a preview as being sent; false when a send is already running for it. */
  claim(id: string): boolean {
    if (this.sending.has(id)) return false;
    this.sending.add(id);
    return true;
  }

  release(id: string): void {
    this.sending.delete(id);
  }
}

const stores = new WeakMap<DeskRuntime, PreviewStore>();

/** The preview store for this Desk runtime (one per running app). */
export function previewsFor(desk: DeskRuntime): PreviewStore {
  let store = stores.get(desk);
  if (!store) {
    store = new PreviewStore(desk.deps.now);
    stores.set(desk, store);
  }
  return store;
}

function isReportChannel(channel: OutboundDraft['channel']): channel is ReportChannel {
  return (REPORT_CHANNELS as readonly string[]).includes(channel);
}

/** A recap preview is the real recap (HTML email with the visit invite, or the WhatsApp text), not hand-written text. */
export function isRecapDraft(draft: Pick<OutboundDraft, 'purpose' | 'channel'>): boolean {
  return draft.purpose === 'recap' && isReportChannel(draft.channel);
}

/**
 * Stores a draft as a preview with its recipient filled in. A recap draft takes its subject and text
 * from the recap as it would go out now. Returns null when the session is unknown.
 */
export function createPreview(desk: DeskRuntime, sessionId: string, draft: OutboundDraft): OutboundPreview | null {
  const state = desk.getState(sessionId);
  if (!state) return null;
  let body = { subject: draft.subject, text: draft.text };
  if (isRecapDraft(draft)) {
    const { rendered } = previewReport(desk, state);
    body = draft.channel === 'email' ? { subject: rendered.subject, text: rendered.text } : { subject: null, text: rendered.whatsapp };
  }
  const preview: OutboundPreview = {
    ...draft,
    ...body,
    // Images only travel on WhatsApp; drop a stray one so the card shows exactly what will be sent.
    mediaUrl: draft.channel === 'whatsapp' ? draft.mediaUrl : null,
    dueInDays: draft.channel === 'jira' ? draft.dueInDays : null,
    id: `${PREVIEW_ID_PREFIX}_${randomUUID().replace(/-/g, '').slice(0, PREVIEW_ID_CHARS)}`,
    sessionId,
    to: outboundRecipient(desk, state, draft.channel),
    createdAt: desk.deps.now(),
  };
  return previewsFor(desk).add(preview);
}

const CHANNEL_NOUN: Record<OutboundDraft['channel'], string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  slack: 'Slack post',
  jira: 'Jira task',
};

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Short title for the activity feed, e.g. "Jira task: Manager approval for 2% discount". */
export function outboundLabel(draft: Pick<OutboundDraft, 'channel' | 'subject' | 'text' | 'mediaUrl' | 'purpose'>): string {
  const noun = draft.channel === 'whatsapp' && draft.mediaUrl ? 'WhatsApp photo' : CHANNEL_NOUN[draft.channel];
  const what = draft.subject?.trim() || (draft.channel === 'jira' || draft.channel === 'slack' ? draft.text.split('\n')[0] : '');
  const prefix = draft.purpose === 'action_item' ? `${noun} (next step)` : noun;
  return what ? `${prefix}: ${clip(what, LABEL_SUBJECT_MAX)}` : prefix;
}

/**
 * Marks a live-notes next step as done, pointing at what it produced (a delivery id, or "done" for
 * a screen command). The scribe keeps `doneRef` when it rewrites the notes. Returns false when the
 * step is not in the notes.
 */
export function markNextStepDone(desk: DeskRuntime, sessionId: string, stepId: string, ref: string): boolean {
  const notes = desk.getState(sessionId)?.consult.notes;
  if (!notes || !notes.nextSteps.some((s) => s.id === stepId)) return false;
  const nextSteps = notes.nextSteps.map((s) => (s.id === stepId ? { ...s, doneRef: ref } : s));
  desk.apply(sessionId, { type: 'set_consult', patch: { notes: { ...notes, nextSteps } } }, 'advisor');
  return true;
}

/**
 * Sends a stored preview with the admin's last edits. A sent preview is removed; a failed or
 * unconfigured one stays so the card can offer another try. Never rejects.
 */
export async function sendPreview(desk: DeskRuntime, preview: OutboundPreview): Promise<Delivery | null> {
  const draft: OutboundDraft = {
    channel: preview.channel,
    subject: preview.subject,
    text: preview.text,
    mediaUrl: preview.mediaUrl,
    dueInDays: preview.dueInDays,
    purpose: preview.purpose,
    nextStepId: preview.nextStepId,
  };
  let delivery: Delivery | null;
  if (isRecapDraft(draft)) {
    const channel = draft.channel as ReportChannel;
    const sent = await sendReport(desk.ctx, preview.sessionId, [channel]);
    delivery = sent.find((d) => d.channel === channel) ?? null;
  } else {
    delivery = await sendOutboundDraft(desk, preview.sessionId, draft, { label: outboundLabel(draft) });
  }
  const store = previewsFor(desk);
  if (delivery?.status === 'sent') {
    store.remove(preview.id);
    if (preview.nextStepId) markNextStepDone(desk, preview.sessionId, preview.nextStepId, delivery.id);
  } else {
    store.replace(preview);
  }
  return delivery;
}

/** What the admin may change on the card before sending. Recaps go out as rendered, so they ignore edits. */
const SendBody = z
  .object({
    text: z.string().trim().min(1).max(4000).optional(),
    subject: z.string().trim().max(200).nullable().optional(),
  })
  .nullish()
  .transform((b) => b ?? {});

export const outboundRoutes: FastifyPluginAsync = async (app) => {
  const desk = () => deskFor(app.ctx);

  app.post<{ Params: { id: string } }>('/api/sessions/:id/outbound/preview', async (req, reply) => {
    const parsed = OutboundDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      return reply.code(400).send({ error: `That message could not be prepared: ${issues}.` });
    }
    const preview = createPreview(desk(), req.params.id, parsed.data);
    if (!preview) return reply.code(404).send({ error: 'Lead not found' });
    return preview;
  });

  app.post<{ Params: { id: string; previewId: string } }>('/api/sessions/:id/outbound/:previewId/send', async (req, reply) => {
    const parsed = SendBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'The message text cannot be empty.' });
    const rt = desk();
    const store = previewsFor(rt);
    const stored = store.get(req.params.id, req.params.previewId);
    if (!stored) return reply.code(404).send({ error: NOT_FOUND });
    if (!store.claim(stored.id)) return reply.code(409).send({ error: ALREADY_SENDING });
    try {
      const edits = isRecapDraft(stored) ? {} : parsed.data;
      const preview: OutboundPreview = {
        ...stored,
        ...(edits.text !== undefined ? { text: edits.text } : {}),
        ...(edits.subject !== undefined ? { subject: edits.subject || null } : {}),
      };
      const delivery = await sendPreview(rt, preview);
      if (!delivery) return reply.code(404).send({ error: 'Lead not found' });
      req.log.info({ sessionId: stored.sessionId, channel: delivery.channel, status: delivery.status }, 'outbound preview sent');
      return { delivery };
    } finally {
      store.release(stored.id);
    }
  });

  app.delete<{ Params: { id: string; previewId: string } }>('/api/sessions/:id/outbound/:previewId', async (req, reply) => {
    const store = previewsFor(desk());
    if (store.get(req.params.id, req.params.previewId)) store.remove(req.params.previewId);
    return reply.code(204).send();
  });
};
