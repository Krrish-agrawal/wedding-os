import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { formatDateTimeIST, formatTimeIST, VIEW_LABELS, type Content, type SessionState } from '@ave/shared';

/** Lines of the human advisor's stretch of the call passed back to the AI. */
const HANDBACK_TRANSCRIPT_LINES = 6;
const MAX_LINE_CHARS = 160;
/** Promises, open asks and next steps from the live notes passed back, each list at most this long. */
const HANDBACK_NOTE_ITEMS = 4;

const ROLE_NAMES = { buyer: 'Buyer', agent: 'You', human: 'Human advisor' } as const;
/** Channels that reach the buyer, and how the AI should name them. */
const BUYER_CHANNELS: ReadonlySet<string> = new Set(['email', 'whatsapp']);
const CHANNEL_WORDS: Record<string, string> = { email: 'email', whatsapp: 'WhatsApp' };

function clip(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > MAX_LINE_CHARS ? `${one.slice(0, MAX_LINE_CHARS - 1)}…` : one;
}

/**
 * A few lines on where the conversation stands, for the Voice workstream to add to the agent's
 * prompt when the human advisor hands the call back to the AI.
 */
export function buildHandoffContext(state: SessionState, content: Content): string {
  const h = state.handoff;
  const human = h.humanName ?? 'A senior advisor';
  const joinedAt = [...state.timeline].reverse().find((e) => e.kind === 'handoff_joined')?.at ?? null;
  const bundle = state.propertyId ? content.byId[state.propertyId] : undefined;
  const lines: string[] = [];

  lines.push(
    `${human} from the team joined this call${joinedAt ? ` at ${formatTimeIST(joinedAt)}` : ''}${h.reason ? ` (reason: ${clip(h.reason)})` : ''} and has now handed it back to you.`,
  );
  lines.push(`On screen now: ${bundle ? `${bundle.property.name}, ` : ''}${VIEW_LABELS[state.view]}.`);

  const known = [
    state.lead.purpose && `looking for ${state.lead.purpose}`,
    state.lead.budget && `budget ${state.lead.budget}`,
    state.lead.timeline && `timeline ${state.lead.timeline}`,
  ].filter(Boolean);
  if (known.length) lines.push(`Buyer ${state.buyer.name}: ${known.join('; ')}.`);
  if (state.lead.objections.length) lines.push(`Objections raised: ${state.lead.objections.map(clip).join('; ')}.`);

  const done: string[] = [];
  for (const [propertyId, offerIds] of Object.entries(state.appliedOffers)) {
    const offers = content.offers.properties[propertyId]?.offers ?? [];
    for (const id of offerIds) done.push(`offer "${offers.find((o) => o.id === id)?.title ?? id}" applied`);
  }
  if (state.booking.status === 'confirmed' && state.booking.propertyId) {
    const b = content.byId[state.booking.propertyId];
    const slot = b?.visits.find((s) => s.id === state.booking.slotId);
    done.push(`site visit booked${b ? ` at ${b.property.name}` : ''}${slot ? ` for ${formatDateTimeIST(slot.start)}` : ''}`);
  }
  // Only messages that reached the buyer count. Recaps have no purpose (older records) or 'recap'; Slack posts
  // and Jira tasks are internal and never mentioned to the buyer.
  const toBuyer = state.deliveries.filter((d) => d.status === 'sent' && BUYER_CHANNELS.has(d.channel));
  const recap = toBuyer.filter((d) => d.purpose === undefined || d.purpose === 'recap').map((d) => CHANNEL_WORDS[d.channel]);
  if (recap.length) done.push(`recap sent by ${[...new Set(recap)].join(' and ')}`);
  const confirmed = toBuyer.filter((d) => d.purpose === 'visit_confirmed').map((d) => CHANNEL_WORDS[d.channel]);
  if (confirmed.length) done.push(`visit confirmation sent by ${[...new Set(confirmed)].join(' and ')}`);
  if (done.length) lines.push(`Already done: ${done.join('; ')}.`);

  const during = joinedAt ? state.transcript.filter((l) => l.final && l.at >= joinedAt && l.role !== 'agent') : [];
  const notes = state.consult.notes;
  const hasNotes = Boolean(notes && (notes.summary.trim() || notes.promises.length || notes.buyerAsks.length));
  if (notes && hasNotes) {
    // The live notes (desk/consult.ts) say what the human agreed, so the AI never contradicts it.
    if (notes.summary.trim()) lines.push(`What ${human} covered: ${clip(notes.summary)}`);
    if (notes.promises.length) {
      lines.push(`${human} promised:`);
      for (const p of notes.promises.slice(0, HANDBACK_NOTE_ITEMS)) {
        lines.push(`- ${clip(p.text)}${p.needsApproval ? ' (not approved yet — do not confirm it)' : ''}`);
      }
    }
    if (notes.buyerAsks.length) lines.push(`Buyer's open asks: ${notes.buyerAsks.slice(0, HANDBACK_NOTE_ITEMS).map((a) => clip(a.text)).join('; ')}.`);
    const pending = notes.nextSteps.filter((s) => !s.doneRef).slice(0, HANDBACK_NOTE_ITEMS);
    if (pending.length) lines.push(`Agreed next steps: ${pending.map((s) => clip(s.text)).join('; ')}.`);
    // Whatever was said after the notes were last written.
    const after = state.consult.updatedAt ? during.filter((l) => l.at > (state.consult.updatedAt ?? 0)) : during;
    if (after.length) {
      lines.push('Said after these notes:');
      for (const l of after.slice(-HANDBACK_TRANSCRIPT_LINES)) lines.push(`- ${ROLE_NAMES[l.role]}: ${clip(l.text)}`);
    }
  } else if (during.length) {
    lines.push('While the human advisor was on the call:');
    for (const l of during.slice(-HANDBACK_TRANSCRIPT_LINES)) lines.push(`- ${ROLE_NAMES[l.role]}: ${clip(l.text)}`);
  }
  lines.push(
    hasNotes
      ? `Welcome the buyer back in one short line and continue from here. Do not repeat what was already covered. Do not contradict what ${human} promised, and never confirm anything marked not approved yet: say the team will confirm it.`
      : 'Welcome the buyer back in one short line and continue from here. Do not repeat what was already covered, and do not restate anything the human advisor agreed unless a tool confirms it.',
  );
  return lines.join('\n');
}

const JoinBody = z.object({ humanName: z.string().trim().min(1).max(60) });

/**
 * Lead Desk handoff routes. The buyer's request arrives through the `set_handoff` action;
 * these mark the human joining and handing back. The Voice workstream reacts to the
 * `joined` (stop the agent) and `returned` (restart it with `buildHandoffContext`) transitions.
 */
export const handoffRoutes: FastifyPluginAsync = async (app) => {
  const { store } = app.ctx;

  app.post<{ Params: { id: string } }>('/api/sessions/:id/handoff/join', async (req, reply) => {
    const parsed = JoinBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Please enter your name before joining.' });
    const state = store.get(req.params.id);
    if (!state) return reply.code(404).send({ error: 'This call is no longer running.' });
    if (state.status === 'ended') return reply.code(409).send({ error: 'This call has ended.' });
    const { humanName } = parsed.data;
    if (state.handoff.status === 'joined' && state.handoff.humanName && state.handoff.humanName !== humanName) {
      return reply.code(409).send({ error: `${state.handoff.humanName} is already on this call.` });
    }
    const next = store.dispatch(state.id, { type: 'set_handoff', patch: { status: 'joined', humanName } }, 'advisor');
    req.log.info({ sessionId: state.id, humanName }, 'human advisor joined');
    return { handoff: next?.handoff ?? state.handoff };
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/handoff/return', async (req, reply) => {
    const state = store.get(req.params.id);
    if (!state) return reply.code(404).send({ error: 'This call is no longer running.' });
    if (state.handoff.status !== 'joined') return reply.code(409).send({ error: 'No human advisor is on this call.' });
    const next = store.dispatch(state.id, { type: 'set_handoff', patch: { status: 'returned' } }, 'advisor');
    req.log.info({ sessionId: state.id }, 'call handed back to the AI advisor');
    return { handoff: next?.handoff ?? state.handoff };
  });
};
