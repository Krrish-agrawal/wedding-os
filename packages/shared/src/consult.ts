import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Delivery channels and purposes (the integrations pipeline)          */
/* ------------------------------------------------------------------ */

/** Everywhere the app can send something. `crm` is HubSpot; `slack` and `jira` are the team's tools. */
export const DELIVERY_CHANNELS = ['email', 'whatsapp', 'crm', 'slack', 'jira'] as const;
export const DeliveryChannelSchema = z.enum(DELIVERY_CHANNELS);
export type DeliveryChannel = z.infer<typeof DeliveryChannelSchema>;

/** Why a delivery went out, so the Desk can group and label it. */
export const DELIVERY_PURPOSES = [
  'recap',
  'visit_confirmed',
  'handoff_alert',
  'handoff_timeout',
  'call_summary',
  'action_item',
  'manual',
  'test',
] as const;
export const DeliveryPurposeSchema = z.enum(DELIVERY_PURPOSES);
export type DeliveryPurpose = z.infer<typeof DeliveryPurposeSchema>;

/** Timeline note kind written when nobody joined a requested handoff in time. */
export const HANDOFF_TIMEOUT_NOTE_KIND = 'handoff_timeout';

/* ------------------------------------------------------------------ */
/* Consult: the human advisor's stretch of the call                     */
/* ------------------------------------------------------------------ */

/** Something the admin can do with one click from a next step in the live notes. */
export const ConsultActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('whatsapp'), text: z.string().min(1).max(1000) }),
  z.object({ kind: z.literal('email'), subject: z.string().min(1).max(160), text: z.string().min(1).max(4000) }),
  z.object({
    kind: z.literal('jira'),
    summary: z.string().min(1).max(200),
    description: z.string().max(4000).optional(),
    dueInDays: z.number().int().min(0).max(30).optional(),
  }),
  z.object({ kind: z.literal('slack'), text: z.string().min(1).max(1500) }),
  /** A plain-language instruction for the copilot, e.g. "show the EMI with 1.5 crore down". */
  z.object({ kind: z.literal('view'), command: z.string().min(1).max(300) }),
]);
export type ConsultAction = z.infer<typeof ConsultActionSchema>;

export const ConsultItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** The words from the call this came from, when there is one. */
  quote: z.string().nullable(),
});
export type ConsultItem = z.infer<typeof ConsultItemSchema>;

export const ConsultPromiseSchema = ConsultItemSchema.extend({
  /** True when the human committed to something that needs a manager's approval (discounts, waivers). */
  needsApproval: z.boolean(),
});
export type ConsultPromise = z.infer<typeof ConsultPromiseSchema>;

export const ConsultNextStepSchema = z.object({
  id: z.string(),
  text: z.string(),
  action: ConsultActionSchema.nullable(),
  /** Set once the admin ran the action: the delivery it produced (or "done" for view commands). */
  doneRef: z.string().nullable(),
});
export type ConsultNextStep = z.infer<typeof ConsultNextStepSchema>;

/** Notes the AI keeps while a human advisor talks with the buyer. Rewritten as the talk goes on. */
export const ConsultNotesSchema = z.object({
  summary: z.string(),
  buyerAsks: z.array(ConsultItemSchema),
  promises: z.array(ConsultPromiseSchema),
  objections: z.array(z.string()),
  nextSteps: z.array(ConsultNextStepSchema),
});
export type ConsultNotes = z.infer<typeof ConsultNotesSchema>;

export const AdminNoteSchema = z.object({ id: z.string(), text: z.string().min(1).max(1000), at: z.number(), by: z.string().nullable() });
export type AdminNote = z.infer<typeof AdminNoteSchema>;

/** Where the consult transcript comes from. */
export const CONSULT_TRANSCRIPT_SOURCES = ['none', 'agora_stt', 'openai'] as const;

export const ConsultSchema = z.object({
  status: z.enum(['idle', 'listening', 'updating', 'error']),
  transcriptSource: z.enum(CONSULT_TRANSCRIPT_SOURCES),
  notes: ConsultNotesSchema.nullable(),
  adminNotes: z.array(AdminNoteSchema),
  updatedAt: z.number().nullable(),
  /** Plain-language problem to show on the notes panel, e.g. why transcription is not running. */
  error: z.string().nullable(),
});
export type Consult = z.infer<typeof ConsultSchema>;

export const EMPTY_CONSULT: Consult = {
  status: 'idle',
  transcriptSource: 'none',
  notes: null,
  adminNotes: [],
  updatedAt: null,
  error: null,
};

/* ------------------------------------------------------------------ */
/* Outbound previews and the admin copilot (HTTP contracts)            */
/* ------------------------------------------------------------------ */

/** Channels the admin can send to by hand (CRM sync stays automatic). */
export const OUTBOUND_CHANNELS = ['whatsapp', 'email', 'slack', 'jira'] as const;
export const OutboundChannelSchema = z.enum(OUTBOUND_CHANNELS);
export type OutboundChannel = z.infer<typeof OutboundChannelSchema>;

/** A message the admin asked for, before it is sent. Nothing leaves the app until the admin confirms it. */
export const OutboundDraftSchema = z.object({
  channel: OutboundChannelSchema,
  /** Email subject, or Jira issue summary. */
  subject: z.string().max(200).nullable(),
  text: z.string().min(1).max(4000),
  /** Public image URL for WhatsApp media messages. */
  mediaUrl: z.string().url().nullable(),
  /** Jira due date offset. */
  dueInDays: z.number().int().min(0).max(30).nullable(),
  purpose: DeliveryPurposeSchema,
  /** The live-notes next step this draft came from, so it can be marked done once sent. */
  nextStepId: z.string().nullable(),
});
export type OutboundDraft = z.infer<typeof OutboundDraftSchema>;

export interface OutboundPreview extends OutboundDraft {
  id: string;
  sessionId: string;
  /** Who it goes to, as shown to the admin: a phone number, email address, Slack channel or Jira project. */
  to: string;
  createdAt: number;
}

export const CopilotRequestSchema = z.object({ command: z.string().trim().min(1).max(500) });
export type CopilotRequest = z.infer<typeof CopilotRequestSchema>;

export interface CopilotStep {
  name: string;
  ok: boolean;
  /** One line on what happened, for the activity log. */
  summary: string;
}

export interface CopilotResult {
  /** A short line for the admin (never spoken to the buyer). */
  reply: string;
  steps: CopilotStep[];
  /** Messages waiting for the admin's confirmation. */
  previews: OutboundPreview[];
}
