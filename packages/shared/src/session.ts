import { z } from 'zod';
import { ExpressionSchema } from './tools.js';
import { CallLanguageSchema, DEFAULT_CALL_LANGUAGE, type CallLanguage } from './language.js';
import { AdminNoteSchema, ConsultSchema, DeliveryChannelSchema, DeliveryPurposeSchema, EMPTY_CONSULT } from './consult.js';
import {
  BlueprintLayerSchema,
  CompassOverlaySchema,
  CustomRouteSchema,
  DEFAULT_VIEW_PARAMS,
  EmiInputsSchema,
  MoneyTabSchema,
  PlaceCategorySchema,
  TourModeSchema,
  ViewIdSchema,
  ViewParamsSchema,
  type ViewId,
} from './views.js';

export const BuyerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(6).max(20),
  email: z.string().trim().email(),
});
export type Buyer = z.infer<typeof BuyerSchema>;

export const LeadFieldsSchema = z.object({
  purpose: z.string().nullable(),
  budget: z.string().nullable(),
  timeline: z.string().nullable(),
  needs: z.array(z.string()),
  concerns: z.array(z.string()),
  objections: z.array(z.string()),
  notes: z.array(z.string()),
});
export type LeadFields = z.infer<typeof LeadFieldsSchema>;

export const AGENT_STATES = ['idle', 'listening', 'thinking', 'speaking', 'silent'] as const;
export const AgentStateSchema = z.object({
  /** Lifecycle of the voice agent session. */
  status: z.enum(['off', 'starting', 'live', 'standby', 'error']),
  /** Conversational state reported by the engine. */
  state: z.enum(AGENT_STATES),
  agentId: z.string().nullable(),
  error: z.string().nullable(),
});
export type AgentStatus = z.infer<typeof AgentStateSchema>;

export const HandoffSchema = z.object({
  status: z.enum(['none', 'requested', 'joined', 'returned']),
  reason: z.string().nullable(),
  humanName: z.string().nullable(),
  requestedAt: z.number().nullable(),
});

export const DeliverySchema = z.object({
  id: z.string(),
  channel: DeliveryChannelSchema,
  to: z.string(),
  status: z.enum(['queued', 'sent', 'failed', 'not_configured']),
  detail: z.string().nullable(),
  at: z.number(),
  /** Why it was sent (absent on deliveries recorded before purposes existed: those are recaps or CRM syncs). */
  purpose: DeliveryPurposeSchema.optional(),
  /** Short title for the activity feed, e.g. "Visit card posted". */
  label: z.string().nullable().optional(),
  /** Provider reference: Slack message ts, Jira issue key, HubSpot deal id. */
  ref: z.string().nullable().optional(),
  /** Link to the thing in the provider (Jira issue, Slack message). */
  url: z.string().nullable().optional(),
});
export type Delivery = z.infer<typeof DeliverySchema>;

export const TranscriptLineSchema = z.object({
  id: z.string(),
  role: z.enum(['buyer', 'agent', 'human']),
  text: z.string(),
  final: z.boolean(),
  at: z.number(),
});
export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;

export const ACTION_SOURCES = ['agent', 'buyer', 'advisor', 'presenter', 'system'] as const;
export const ActionSourceSchema = z.enum(ACTION_SOURCES);
export type ActionSource = z.infer<typeof ActionSourceSchema>;

export const TimelineEventSchema = z.object({
  at: z.number(),
  source: ActionSourceSchema,
  kind: z.string(),
  label: z.string(),
  propertyId: z.string().nullable(),
  view: ViewIdSchema.nullable(),
  /** Facial expression the advisor should show for this moment (from a tool result). */
  expression: ExpressionSchema.optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const SessionStateSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  status: z.enum(['ringing', 'live', 'ended']),
  buyer: BuyerSchema,
  /** The one language the call runs in (recognition, replies, voice). */
  language: CallLanguageSchema,
  propertyId: z.string().nullable(),
  view: ViewIdSchema,
  params: ViewParamsSchema,
  /** Offers applied, per property id. */
  appliedOffers: z.record(z.string(), z.array(z.string())),
  booking: z.object({
    propertyId: z.string().nullable(),
    slotId: z.string().nullable(),
    status: z.enum(['none', 'confirmed']),
  }),
  lead: LeadFieldsSchema,
  agent: AgentStateSchema,
  handoff: HandoffSchema,
  /** Short honest status while something runs, e.g. "Calculating EMI". */
  activity: z.object({ label: z.string(), at: z.number() }).nullable(),
  transcript: z.array(TranscriptLineSchema),
  timeline: z.array(TimelineEventSchema),
  deliveries: z.array(DeliverySchema),
  /** The human advisor's consult: live notes the AI keeps, and the admin's own notes. */
  consult: ConsultSchema,
  /** Bumped on every change so clients can ignore stale snapshots. */
  rev: z.number().int(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export function createSessionState(id: string, buyer: Buyer, now: number, language: CallLanguage = DEFAULT_CALL_LANGUAGE): SessionState {
  return {
    id,
    createdAt: now,
    status: 'ringing',
    buyer,
    language,
    propertyId: null,
    view: 'shortlist',
    params: structuredClone(DEFAULT_VIEW_PARAMS),
    appliedOffers: {},
    booking: { propertyId: null, slotId: null, status: 'none' },
    lead: { purpose: null, budget: null, timeline: null, needs: [], concerns: [], objections: [], notes: [] },
    agent: { status: 'off', state: 'idle', agentId: null, error: null },
    handoff: { status: 'none', reason: null, humanName: null, requestedAt: null },
    activity: null,
    transcript: [],
    timeline: [],
    deliveries: [],
    consult: structuredClone(EMPTY_CONSULT),
    rev: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Actions: the only way session state changes.                        */
/* Tools, buyer clicks, the human advisor and presenter keys all       */
/* produce these and run them through the same reducer.                */
/* ------------------------------------------------------------------ */

const viewAction = <V extends ViewId, S extends z.ZodTypeAny>(view: V, params: S) =>
  z.object({ type: z.literal('set_view'), view: z.literal(view), params: params.optional() });

export const SetViewActionSchema = z.discriminatedUnion('view', [
  viewAction('shortlist', z.object({})),
  viewAction('tour', z.object({ stopId: z.string().nullable(), mode: TourModeSchema }).partial()),
  viewAction('blueprint', z.object({ layer: BlueprintLayerSchema, roomId: z.string().nullable() }).partial()),
  viewAction('locality', z.object({ category: PlaceCategorySchema.nullable(), placeId: z.string().nullable() }).partial()),
  viewAction('commute', z.object({ destinationId: z.string().nullable(), custom: CustomRouteSchema.nullable() }).partial()),
  viewAction('compass', z.object({ minutes: z.number().int().min(0).max(1439), overlay: CompassOverlaySchema, roomId: z.string().nullable() }).partial()),
  viewAction('money', z.object({ tab: MoneyTabSchema, emi: EmiInputsSchema.nullable() }).partial()),
  viewAction('legal', z.object({ docId: z.string().nullable() }).partial()),
  viewAction('booking', z.object({ slotId: z.string().nullable() }).partial()),
]);

export const SessionActionSchema = z.union([
  SetViewActionSchema,
  z.object({ type: z.literal('set_property'), propertyId: z.string() }),
  z.object({ type: z.literal('set_status'), status: z.enum(['ringing', 'live', 'ended']) }),
  z.object({ type: z.literal('set_language'), language: CallLanguageSchema }),
  z.object({ type: z.literal('apply_offer'), propertyId: z.string(), offerId: z.string() }),
  z.object({ type: z.literal('remove_offer'), propertyId: z.string(), offerId: z.string() }),
  z.object({ type: z.literal('confirm_booking'), propertyId: z.string(), slotId: z.string() }),
  z.object({ type: z.literal('update_lead'), patch: LeadFieldsSchema.partial() }),
  z.object({ type: z.literal('set_agent'), patch: AgentStateSchema.partial() }),
  z.object({ type: z.literal('set_handoff'), patch: HandoffSchema.partial() }),
  z.object({ type: z.literal('set_activity'), label: z.string().nullable() }),
  z.object({ type: z.literal('add_transcript'), line: TranscriptLineSchema }),
  z.object({ type: z.literal('upsert_delivery'), delivery: DeliverySchema }),
  /** Server only: consult status and the AI's live notes. */
  z.object({ type: z.literal('set_consult'), patch: ConsultSchema.partial() }),
  /** The human advisor's own note during a consult (advisor clients only). */
  z.object({ type: z.literal('add_admin_note'), note: AdminNoteSchema }),
  /** Free-form timeline note, e.g. "Buyer asked about schools". */
  z.object({ type: z.literal('note'), kind: z.string(), label: z.string(), expression: ExpressionSchema.optional() }),
]);
export type SessionAction = z.infer<typeof SessionActionSchema>;
export type SetViewAction = z.infer<typeof SetViewActionSchema>;

/** An action plus who caused it and when. Reducers stay pure: time comes in here. */
export const ActionEnvelopeSchema = z.object({
  action: SessionActionSchema,
  source: ActionSourceSchema,
  at: z.number(),
});
export type ActionEnvelope = z.infer<typeof ActionEnvelopeSchema>;

/* ------------------------------------------------------------------ */
/* WebSocket protocol                                                  */
/* ------------------------------------------------------------------ */

export const ClientRoleSchema = z.enum(['buyer', 'advisor', 'studio']);
export type ClientRole = z.infer<typeof ClientRoleSchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), sessionId: z.string(), role: ClientRoleSchema }),
  /** A click, slider or key press on a client. Validated and reduced on the server. */
  z.object({ type: z.literal('action'), action: SessionActionSchema }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: 'state'; state: SessionState }
  | { type: 'error'; message: string }
  | { type: 'pong' };

/** Desk-wide feed for /desk: list of live sessions and lead updates. */
export type DeskMessage =
  | { type: 'sessions'; sessions: SessionSummary[] }
  | { type: 'handoff_requested'; sessionId: string; buyerName: string; reason: string | null };

export interface SessionSummary {
  id: string;
  buyerName: string;
  status: SessionState['status'];
  propertyId: string | null;
  view: ViewId;
  startedAt: number;
  handoff: SessionState['handoff']['status'];
  agentStatus: SessionState['agent']['status'];
}

export function summarizeSession(s: SessionState): SessionSummary {
  return {
    id: s.id,
    buyerName: s.buyer.name,
    status: s.status,
    propertyId: s.propertyId,
    view: s.view,
    startedAt: s.createdAt,
    handoff: s.handoff.status,
    agentStatus: s.agent.status,
  };
}
