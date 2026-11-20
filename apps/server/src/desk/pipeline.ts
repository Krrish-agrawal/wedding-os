import type { FastifyPluginAsync } from 'fastify';
import {
  DELIVERY_CHANNELS,
  PIPELINE_FUNNEL,
  PIPELINE_OUTCOME_NOTE_KINDS,
  PIPELINE_OUTCOME_NOTE_LABELS,
  PIPELINE_STAGE_LABELS,
  PipelineOutcomeRequestSchema,
  deliveryTitle,
  pipelineOutcome,
  pipelineStage,
  reachedStage,
  type ActivityItem,
  type Delivery,
  type LeadSummary,
  type PipelineBadge,
  type PipelineCard,
  type PipelineOutcome,
  type PipelineResponse,
  type SessionState,
} from '@ave/shared';
import { listLeads } from './leads.js';
import { deskFor, type DeskRuntime } from './runtime.js';

/** Recent deliveries shown in the activity feed. */
export const ACTIVITY_LIMIT = 60;
const PERCENT = 100;

/** The latest attempt per channel, with the latest successful provider reference kept. */
export function deliveryBadges(deliveries: Delivery[]): PipelineBadge[] {
  const sorted = [...deliveries].sort((a, b) => a.at - b.at);
  const badges: PipelineBadge[] = [];
  for (const channel of DELIVERY_CHANNELS) {
    const mine = sorted.filter((d) => d.channel === channel);
    const latest = mine.at(-1);
    if (!latest) continue;
    const sent = mine.filter((d) => d.status === 'sent');
    const withRef = [...sent].reverse().find((d) => d.ref || d.url);
    badges.push({
      channel,
      status: latest.status,
      sent: sent.length,
      ref: withRef?.ref ?? null,
      url: withRef?.url ?? null,
      detail: latest.detail,
      at: latest.at,
    });
  }
  return badges;
}

/** The property a card is about: the booked one, else the one open now, else the first one viewed. */
function cardProperty(state: SessionState, lead: LeadSummary): string | null {
  return state.booking.propertyId ?? state.propertyId ?? lead.propertyIds[0] ?? null;
}

function cardFor(desk: DeskRuntime, lead: LeadSummary, state: SessionState): PipelineCard {
  const { content } = desk.ctx;
  const propertyId = cardProperty(state, lead);
  const bundle = propertyId ? content.byId[propertyId] : undefined;
  const slot = state.booking.status === 'confirmed' ? content.byId[state.booking.propertyId ?? '']?.visits.find((s) => s.id === state.booking.slotId) : undefined;
  return {
    id: lead.id,
    buyerName: lead.buyer.name,
    propertyId,
    propertyName: bundle?.property.name ?? null,
    stage: pipelineStage(state, lead.live),
    live: lead.live,
    score: lead.score,
    tier: lead.tier,
    tierRank: lead.tierRank,
    tierCount: lead.tierCount,
    handoff: lead.handoff,
    visitStart: slot?.start ?? null,
    lastActivityAt: lead.lastActivityAt,
    badges: deliveryBadges(state.deliveries),
  };
}

/** Every lead on the board, the funnel across the top, and the latest deliveries across leads. */
export function buildPipeline(desk: DeskRuntime, now: number): PipelineResponse {
  const cards: PipelineCard[] = [];
  const states: SessionState[] = [];
  const activity: ActivityItem[] = [];
  for (const lead of listLeads(desk, now)) {
    const state = desk.getState(lead.id);
    if (!state) continue;
    states.push(state);
    cards.push(cardFor(desk, lead, state));
    for (const d of state.deliveries) {
      activity.push({
        id: d.id,
        sessionId: state.id,
        buyerName: state.buyer.name,
        channel: d.channel,
        status: d.status,
        title: deliveryTitle(d),
        purpose: d.purpose ?? null,
        to: d.to,
        detail: d.detail,
        ref: d.ref ?? null,
        url: d.url ?? null,
        at: d.at,
      });
    }
  }
  const total = states.length;
  const funnel = PIPELINE_FUNNEL.map((stage) => {
    const reached = states.filter((s) => reachedStage(s, stage)).length;
    return { stage, label: PIPELINE_STAGE_LABELS[stage], reached, pct: total ? Math.round((reached / total) * PERCENT) : 0 };
  });
  const won = states.filter((s) => pipelineOutcome(s) === 'won').length;
  const closed = won + states.filter((s) => pipelineOutcome(s) === 'lost').length;
  activity.sort((a, b) => b.at - a.at);
  return { cards, funnel, winRate: closed ? Math.round((won / closed) * PERCENT) : null, activity: activity.slice(0, ACTIVITY_LIMIT) };
}

/** Records won, lost or reopened as a timeline note on the lead (live or past), by the admin. */
export function setOutcome(desk: DeskRuntime, sessionId: string, outcome: PipelineOutcome): SessionState | undefined {
  return desk.apply(sessionId, { type: 'note', kind: PIPELINE_OUTCOME_NOTE_KINDS[outcome], label: PIPELINE_OUTCOME_NOTE_LABELS[outcome] }, 'advisor');
}

export const pipelineRoutes: FastifyPluginAsync = async (app) => {
  const desk = () => deskFor(app.ctx);

  app.get('/api/pipeline', async () => buildPipeline(desk(), Date.now()));

  app.post<{ Params: { id: string } }>('/api/leads/:id/outcome', async (req, reply) => {
    const parsed = PipelineOutcomeRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Choose won, lost or open.' });
    const rt = desk();
    if (!setOutcome(rt, req.params.id, parsed.data.outcome)) return reply.code(404).send({ error: 'Lead not found' });
    const card = buildPipeline(rt, Date.now()).cards.find((c) => c.id === req.params.id);
    return { card };
  });
};
